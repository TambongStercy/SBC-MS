import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { memberAuthConfig } from '../config/member-auth';
import { IMemberAuth, MemberAuthModel } from '../database/models/member-auth.model';
import UserModel, { IUser } from '../database/models/user.model';
import { userRepository } from '../database/repositories/user.repository';
import { AppError, AuthenticatorRequiredError } from '../utils/errors';
import logger from '../utils/logger';
import { otpMatches } from '../utils/otp.utils';
import { withdrawalLockFields } from '../utils/withdrawal-lock';
import { notificationService } from './clients/notification.service.client';
import { userService } from './user.service';

const log = logger.getLogger('MemberAuth');

/**
 * Member authenticator app (Security plan Phase 3, Sterling 2026-11-20: "to
 * change number user should use [the code] from authenticator not otp from
 * email … to withdraw money they must have setup authenticator").
 *
 * Setup: account password → code sent to the account's own e-mail/WhatsApp
 * (a stolen session alone cannot set one up) → QR code → first app code →
 * 10 backup codes, shown once. The app code (or a backup code, once each) then
 * confirms every withdrawal and every MoMo number / crypto wallet change.
 * Five wrong codes in 24 h lock the checks for 15 min, then 1 h, then 24 h.
 * Same design as the admin authenticator (#424), with its own key.
 */
authenticator.options = { window: 1, step: 30, digits: 6 };

export type AuthenticatorAction = 'withdrawal' | 'momo_change' | 'crypto_change';

const SETUP_TARGET = 'authenticator';
const LOCK_STEPS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NOT_CONFIGURED = () => new AppError('L’application d’authentification est momentanément indisponible. Réessayez plus tard.', 503);

function key(): Buffer {
    const k = memberAuthConfig.totpEncKey;
    if (!k) {
        log.error('MEMBER_TOTP_ENC_KEY is missing or not 32 bytes (base64): member authenticator refused.');
        throw NOT_CONFIGURED();
    }
    return k;
}

function encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

function decrypt(blob: string): string {
    const [v, iv, tag, ct] = blob.split(':');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

const normalizeBackup = (c: string) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashBackup = (c: string) => crypto.createHmac('sha256', key()).update(`member-backup:${normalizeBackup(c)}`).digest('hex');

export function generateBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
        const chars = Array.from(crypto.randomBytes(12)).map(b => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('');
        codes.push(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
    }
    return { codes, hashes: codes.map(hashBackup) };
}

/** The 30-second step a 6-digit code matches (±1 step, so ±30 s of clock drift), or null. */
export function verifyTotp(secret: string, code: string): number | null {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return null;
    const delta = authenticator.checkDelta(c, secret);
    if (delta === null || delta === undefined) return null;
    return Math.floor(Date.now() / 1000 / 30) + delta;
}

const isLocked = (a: Pick<IMemberAuth, 'lockedUntil'> | null) => !!a?.lockedUntil && a.lockedUntil.getTime() > Date.now();
const hhmm = (d: Date) => d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' });

async function activeUser(userId: string | Types.ObjectId, withPassword = false): Promise<IUser> {
    const q = UserModel.findById(userId);
    const user = withPassword ? await q.select('+password') : await q;
    if (!user || user.blocked || user.deleted) throw new AppError('User account is inactive or not found.', 403);
    return user;
}

function alert(user: IUser, subject: string, body: string): void {
    if (!user.email) return;
    void notificationService.sendAccountEmail({ userId: String(user._id), email: user.email, subject, body }).catch(() => undefined);
}

class MemberAuthService {
    async status(userId: string | Types.ObjectId): Promise<{ enabled: boolean; enrolledAt: string | null; backupCodesRemaining: number; lockedUntil: string | null }> {
        const a = await MemberAuthModel.findOne({ userId }).lean();
        return {
            enabled: !!a?.totpSecretEnc,
            enrolledAt: a?.totpEnrolledAt ? new Date(a.totpEnrolledAt).toISOString() : null,
            backupCodesRemaining: (a?.backupCodes || []).filter(b => !b.usedAt).length,
            lockedUntil: isLocked(a) ? new Date(a!.lockedUntil!).toISOString() : null,
        };
    }

    async isEnabled(userId: string | Types.ObjectId): Promise<boolean> {
        return !!(await MemberAuthModel.exists({ userId, totpSecretEnc: { $ne: null } }));
    }

    /** Step 1: the account password, then a code to the account's own e-mail (or WhatsApp). */
    async requestSetup(userId: string | Types.ObjectId, input: { password?: unknown }): Promise<{ sentTo: string }> {
        key();
        const user = await activeUser(userId, true);
        if (await this.isEnabled(user._id)) throw new AppError('L’application d’authentification est déjà configurée sur votre compte.', 409);
        if (!userService.canReachOwnerForCode(user)) {
            throw new AppError('Votre compte n’a ni adresse e-mail ni WhatsApp pour recevoir le code : contactez le support.', 400);
        }
        const password = typeof input.password === 'string' ? input.password : '';
        const isResend = !password && (user.otps || []).some(o =>
            o.purpose === 'setupAuthenticator' && o.target === SETUP_TARGET && new Date(o.expiration) > new Date());
        if (!isResend && (!password || !user.password || !(await bcrypt.compare(password, user.password)))) {
            throw new AppError(password ? 'Mot de passe incorrect.' : 'Votre code a expiré : recommencez.', 400);
        }
        const code = await userService.generateAndStoreOtp(user._id, 'otps', 10, { purpose: 'setupAuthenticator', target: SETUP_TARGET });
        const sentTo = await userService.sendChangeCodeToOwner(user, code, 'setupAuthenticator');
        log.info(`Authenticator setup code sent for user ${user._id} (${sentTo}).`);
        return { sentTo };
    }

    /** Step 2: the code received → a new secret, shown as a QR code. */
    async startSetup(userId: string | Types.ObjectId, input: { code?: unknown }): Promise<{ qrDataUrl: string; secret: string; otpauthUrl: string }> {
        key();
        const user = await activeUser(userId);
        if (await this.isEnabled(user._id)) throw new AppError('L’application d’authentification est déjà configurée sur votre compte.', 409);
        const code = typeof input.code === 'string' ? input.code.trim() : '';
        const now = new Date();
        const ok = !!code && (user.otps || []).some(o => o.purpose === 'setupAuthenticator' && o.target === SETUP_TARGET
            && otpMatches(o.code, code) && new Date(o.expiration) > now);
        if (!ok) throw new AppError('Code invalide ou expiré. Utilisez le dernier code reçu.', 400);
        await userRepository.clearOtps(user._id, 'otps');

        const secret = authenticator.generateSecret(20);
        await MemberAuthModel.updateOne(
            { userId: user._id },
            { $set: { pendingSecretEnc: encrypt(secret), pendingExpiresAt: new Date(now.getTime() + memberAuthConfig.setupTtlMs) }, $setOnInsert: { userId: user._id } },
            { upsert: true },
        );
        const label = user.email || user.phoneNumber || String(user._id);
        const otpauthUrl = authenticator.keyuri(label, memberAuthConfig.issuer, secret);
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
        return { qrDataUrl, secret, otpauthUrl };
    }

    /** Step 3: the first code from the app turns it on and returns 10 backup codes (shown once). */
    async confirmSetup(userId: string | Types.ObjectId, input: { code?: unknown }): Promise<{ backupCodes: string[]; enrolledAt: string }> {
        key();
        const user = await activeUser(userId);
        const a = await MemberAuthModel.findOne({ userId: user._id });
        if (a?.totpSecretEnc) throw new AppError('L’application d’authentification est déjà configurée sur votre compte.', 409);
        if (!a?.pendingSecretEnc || !a.pendingExpiresAt || a.pendingExpiresAt.getTime() < Date.now()) {
            throw new AppError('La configuration a expiré : recommencez depuis le début.', 400);
        }
        const step = verifyTotp(decrypt(a.pendingSecretEnc), String(input.code ?? ''));
        if (step === null) throw new AppError('Code incorrect. Tapez le code à 6 chiffres affiché par l’application (vérifiez que l’heure du téléphone est automatique).', 400);

        const { codes, hashes } = generateBackupCodes(10);
        const now = new Date();
        const r = await MemberAuthModel.updateOne(
            { _id: a._id, totpSecretEnc: null, pendingSecretEnc: a.pendingSecretEnc },
            {
                $set: {
                    totpSecretEnc: a.pendingSecretEnc, totpEnrolledAt: now, lastUsedStep: step,
                    backupCodes: hashes.map(hash => ({ hash, usedAt: null })),
                    pendingSecretEnc: null, pendingExpiresAt: null, failures: 0, failuresSince: null, lockedUntil: null,
                },
            },
        );
        if (r.modifiedCount !== 1) throw new AppError('La configuration a déjà été terminée.', 409);
        log.info(`User ${user._id} set up an authenticator app.`);
        alert(user, 'Application d’authentification activée sur votre compte SBC',
            'L’application d’authentification vient d’être activée sur votre compte SBC. Elle vous sera demandée pour chaque retrait et pour changer votre numéro Mobile Money ou votre portefeuille crypto. Si ce n’était pas vous, changez votre mot de passe et contactez immédiatement le support.');
        return { backupCodes: codes, enrolledAt: now.toISOString() };
    }

    /**
     * Checks a code from the app (6 digits, accepted once) or a backup code
     * (used once). Throws AuthenticatorRequiredError when the member has none.
     */
    async verifyCode(userId: string | Types.ObjectId, rawCode: unknown, action: AuthenticatorAction): Promise<{ method: 'totp' | 'backup_code'; backupCodesRemaining: number }> {
        const a = await MemberAuthModel.findOne({ userId });
        if (!a?.totpSecretEnc) throw new AuthenticatorRequiredError();
        key();
        if (isLocked(a)) {
            throw new AppError(`Trop de codes incorrects : réessayez après ${hhmm(a.lockedUntil!)}.`, 429);
        }
        const code = typeof rawCode === 'string' ? rawCode.trim() : '';
        const digits = code.replace(/\s/g, '');
        let method: 'totp' | 'backup_code';
        if (/^\d{6}$/.test(digits)) {
            const step = verifyTotp(decrypt(a.totpSecretEnc), digits);
            // A code is accepted once (replay), atomically.
            const r = step === null ? null : await MemberAuthModel.updateOne(
                { _id: a._id, $or: [{ lastUsedStep: null }, { lastUsedStep: { $lt: step } }] },
                { $set: { lastUsedStep: step, failures: 0, failuresSince: null } },
            );
            if (step !== null && (!r || r.modifiedCount !== 1)) {
                // A right code that already served (same 30 s): not a guess, so not counted.
                log.warn(`Authenticator code replayed for user ${userId} (${action}).`);
                throw new AppError('Ce code a déjà servi. Attendez le code suivant de l’application (30 secondes au plus) et tapez-le.', 400);
            }
            if (!r) return this.fail(a, action, 'wrong code');
            method = 'totp';
        } else if (normalizeBackup(code).length === 12) {
            const r = await MemberAuthModel.updateOne(
                { _id: a._id, backupCodes: { $elemMatch: { hash: hashBackup(code), usedAt: null } } },
                { $set: { 'backupCodes.$.usedAt': new Date(), failures: 0, failuresSince: null } },
            );
            if (r.modifiedCount !== 1) return this.fail(a, action, 'wrong backup code');
            method = 'backup_code';
        } else {
            return this.fail(a, action, 'malformed code');
        }
        const remaining = a.backupCodes.filter(b => !b.usedAt).length - (method === 'backup_code' ? 1 : 0);
        log.info(`Authenticator ${method} accepted for user ${userId} (${action}).`);
        if (method === 'backup_code') {
            const user = await UserModel.findById(userId);
            if (user) alert(user, 'Un code de secours SBC a été utilisé',
                `Un de vos codes de secours vient d’être utilisé sur votre compte SBC. Il vous en reste ${remaining}. Si ce n’était pas vous, changez votre mot de passe et contactez immédiatement le support.`);
        }
        return { method, backupCodesRemaining: remaining };
    }

    private async fail(a: IMemberAuth, action: AuthenticatorAction, why: string): Promise<never> {
        const now = new Date();
        const fresh = !a.failuresSince || now.getTime() - a.failuresSince.getTime() > 24 * 3600 * 1000;
        const failures = fresh ? 1 : a.failures + 1;
        const update: Record<string, unknown> = { failures, failuresSince: fresh ? now : a.failuresSince };
        log.warn(`Authenticator code refused for user ${a.userId} (${action}: ${why}, failure ${failures}).`);
        let lockedUntil: Date | null = null;
        if (failures % 5 === 0) {
            const ms = LOCK_STEPS_MS[Math.min(failures / 5, LOCK_STEPS_MS.length) - 1];
            lockedUntil = new Date(now.getTime() + ms);
            update.lockedUntil = lockedUntil;
            const user = await UserModel.findById(a.userId);
            if (user) alert(user, 'Codes d’authentification bloqués sur votre compte SBC',
                `Après plusieurs codes incorrects, les codes de l’application d’authentification sont bloqués sur votre compte SBC pendant ${Math.round(ms / 60000)} minutes. Si ce n’était pas vous, changez votre mot de passe et contactez le support.`);
        }
        await MemberAuthModel.updateOne({ _id: a._id }, { $set: update });
        if (lockedUntil) throw new AppError(`Trop de codes incorrects : réessayez après ${hhmm(lockedUntil)}.`, 429);
        throw new AppError('Code incorrect. Tapez le code à 6 chiffres affiché par l’application, ou un code de secours.', 400);
    }

    /**
     * Support reset after a lost phone (plan: ID + selfie checked by support).
     * Removes the authenticator and locks withdrawals 72 h; the member sets up
     * a new one. Used by scripts/reset-member-authenticator.ts.
     */
    async resetBySupport(userId: string | Types.ObjectId, reason: string): Promise<{ withdrawalsLockedUntil: string }> {
        const user = await activeUser(userId);
        await MemberAuthModel.updateOne(
            { userId: user._id },
            { $set: { totpSecretEnc: null, totpEnrolledAt: null, lastUsedStep: null, backupCodes: [], pendingSecretEnc: null, pendingExpiresAt: null, failures: 0, failuresSince: null, lockedUntil: null } },
        );
        const lock = withdrawalLockFields('authenticator_reset', new Date(), memberAuthConfig.resetLockHours);
        await userRepository.updateById(user._id, lock);
        log.warn(`Authenticator of user ${user._id} reset by support (${reason}); withdrawals locked until ${lock.withdrawalsLockedUntil.toISOString()}.`);
        alert(user, 'L’application d’authentification de votre compte SBC a été réinitialisée',
            `À votre demande, le support a retiré l’application d’authentification de votre compte SBC. Configurez-en une nouvelle depuis votre profil. Par sécurité, les retraits sont bloqués pendant ${memberAuthConfig.resetLockHours} h. Si vous n’avez rien demandé, contactez immédiatement le support.`);
        return { withdrawalsLockedUntil: lock.withdrawalsLockedUntil.toISOString() };
    }
}

export const memberAuthService = new MemberAuthService();
