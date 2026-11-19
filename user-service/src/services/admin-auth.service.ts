import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import config from '../config';
import { AdminAuthModel, AdminLoginChallengeModel, AdminSessionModel, IAdminAuth } from '../database/models/admin-auth.model';
import { ADMIN_CAPABLE_ROLES, IUser } from '../database/models/user.model';
import { userRepository } from '../database/repositories/user.repository';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import { notificationService } from './clients/notification.service.client';
import { userService } from './user.service';

const log = logger.getLogger('AdminAuth');

/**
 * Admin sign-in, like the support desk (2026-11-19, Sterling: "It should be like
 * support desk"):
 *   1. email + password            → challenge (stage 'totp', or 'email' the first time)
 *   2a. authenticator or backup code → session
 *   2b. first time only: emailed code → enrol an authenticator (QR) → session + 10 backup codes
 * Every refusal gives the same answer (no account enumeration). Five failures in
 * 24 h lock the account (15 min, then 1 h, then 24 h) and email the admin.
 * The admin token carries `asid`; the gateway checks that session on every
 * admin call (revoked, 30 min idle, 12 h maximum).
 */

authenticator.options = { window: 1, step: 30, digits: 6 };

export interface ReqCtx { ip: string; userAgent: string }

const INVALID = () => new AppError('Identifiants ou code invalides.', 401);
const NOT_CONFIGURED = () => new AppError('La connexion à l’administration est indisponible pour le moment.', 503);
const LOCK_STEPS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomId = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const isStaff = (u: IUser | null): u is IUser => !!u && ADMIN_CAPABLE_ROLES.includes(u.role) && !u.blocked && !u.deleted;

/** A valid bcrypt hash of a random string: unknown emails cost the same time. */
const DUMMY_HASH = bcrypt.hashSync(randomId(16), 10);

function key(): Buffer {
    const k = config.adminAuth.totpEncKey;
    if (!k) {
        log.error('ADMIN_TOTP_ENC_KEY is missing or not 32 bytes (base64): admin sign-in is refused.');
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
const hashBackup = (c: string) => crypto.createHmac('sha256', key()).update(`admin-backup:${normalizeBackup(c)}`).digest('hex');

export function generateBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
        const chars = Array.from(crypto.randomBytes(12)).map(b => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('');
        codes.push(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
    }
    return { codes, hashes: codes.map(hashBackup) };
}

/** The 30-second step a 6-digit code matches (±1 step), or null. */
export function verifyTotp(secret: string, code: string): number | null {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return null;
    const delta = authenticator.checkDelta(c, secret);
    if (delta === null || delta === undefined) return null;
    return Math.floor(Date.now() / 1000 / 30) + delta;
}

const deviceHash = (userId: string, ctx: ReqCtx) => sha256(`${userId}|${ctx.ip}|${ctx.userAgent}`);

async function authOf(userId: Types.ObjectId | string) {
    return AdminAuthModel.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
}

const isLocked = (a: Pick<IAdminAuth, 'lockedUntil'> | null) => !!a?.lockedUntil && a.lockedUntil.getTime() > Date.now();

async function recordFailure(user: IUser, ctx: ReqCtx, step: string): Promise<void> {
    const now = new Date();
    const a = await authOf(user._id);
    const fresh = !a.failuresSince || now.getTime() - a.failuresSince.getTime() > 24 * 3600 * 1000;
    const failures = fresh ? 1 : a.failures + 1;
    const update: Record<string, unknown> = { failures, failuresSince: fresh ? now : a.failuresSince };
    log.warn(`Admin sign-in refused for ${user.email}: ${step} (failure ${failures}, ip ${ctx.ip}).`);
    if (failures % 5 === 0) {
        const ms = LOCK_STEPS_MS[Math.min(failures / 5, LOCK_STEPS_MS.length) - 1];
        update.lockedUntil = new Date(now.getTime() + ms);
        log.warn(`Admin account ${user.email} locked for ${ms / 60000} min after ${failures} failures.`);
        void notificationService.sendAccountEmail({
            userId: String(user._id), email: user.email,
            subject: 'SBC Admin : connexion bloquée sur votre compte',
            body: `Après plusieurs tentatives de connexion échouées à l’administration SBC, votre compte est bloqué pendant ${Math.round(ms / 60000)} minutes. Si ce n’était pas vous, changez votre mot de passe et prévenez immédiatement le super administrateur.`,
        }).catch(() => undefined);
    }
    await AdminAuthModel.updateOne({ _id: a._id }, { $set: update });
}

async function saveChallenge(userId: Types.ObjectId, stage: 'email' | 'enroll' | 'totp', ip: string): Promise<string> {
    const id = randomId(24);
    await AdminLoginChallengeModel.create({
        idHash: sha256(id), userId, stage, attempts: 0, ip,
        expiresAt: new Date(Date.now() + config.adminAuth.challengeTtlMs),
    });
    return id;
}

async function loadChallenge(id: unknown, stage: 'email' | 'enroll' | 'totp') {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(id)) return null;
    const c = await AdminLoginChallengeModel.findOne({ idHash: sha256(id), expiresAt: { $gt: new Date() } });
    return c && c.stage === stage ? c : null;
}

async function failChallenge(c: { _id: unknown; attempts: number }, user: IUser, ctx: ReqCtx, step: string): Promise<never> {
    if (c.attempts + 1 >= 5) await AdminLoginChallengeModel.deleteOne({ _id: c._id });
    else await AdminLoginChallengeModel.updateOne({ _id: c._id }, { $inc: { attempts: 1 } });
    await recordFailure(user, ctx, step);
    throw INVALID();
}

/** Loads the challenge's account; anything not an active, unlocked staff account ends the challenge. */
async function accountFor(c: { _id: unknown; userId: Types.ObjectId }): Promise<IUser> {
    const user = await userRepository.findById(c.userId);
    const a = await AdminAuthModel.findOne({ userId: c.userId }).lean();
    if (!isStaff(user) || isLocked(a)) {
        await AdminLoginChallengeModel.deleteOne({ _id: c._id });
        throw INVALID();
    }
    return user;
}

export interface IssuedAdminSession { token: string; sessionId: string; expiresAt: string; user: unknown }

async function openSession(user: IUser, ctx: ReqCtx, method: string): Promise<IssuedAdminSession> {
    const now = new Date();
    const userId = String(user._id);
    const a = await authOf(user._id);
    const dh = deviceHash(userId, ctx);
    const known = a.knownDevices.some(d => d.hash === dh);
    const devices = known
        ? a.knownDevices.map(d => (d.hash === dh ? { hash: d.hash, firstSeenAt: d.firstSeenAt, lastSeenAt: now } : d))
        : [...a.knownDevices, { hash: dh, firstSeenAt: now, lastSeenAt: now }].slice(-20);
    await AdminAuthModel.updateOne({ _id: a._id }, {
        $set: { knownDevices: devices, lastLoginAt: now, lastLoginIp: ctx.ip, failures: 0, failuresSince: null, lockedUntil: null },
    });
    const absoluteExpiresAt = new Date(now.getTime() + config.adminAuth.absoluteTimeoutMs);
    const session = await AdminSessionModel.create({
        userId: user._id, createdAt: now, lastActivityAt: now, absoluteExpiresAt,
        ip: ctx.ip, userAgent: (ctx.userAgent || '').slice(0, 300), method,
    });
    const sid = String(session._id);
    const token = jwt.sign(
        { userId, id: userId, email: user.email, role: user.role, asid: sid },
        config.jwt.secret,
        { expiresIn: Math.floor(config.adminAuth.absoluteTimeoutMs / 1000) },
    );
    log.info(`Admin ${user.email} signed in (${method}, session ${sid}, ip ${ctx.ip}${known ? '' : ', new device'}).`);
    if (!known && a.knownDevices.length > 0) {
        void notificationService.sendAccountEmail({
            userId, email: user.email,
            subject: 'SBC Admin : nouvelle connexion à votre compte',
            body: `Une connexion à l’administration SBC vient d’avoir lieu depuis un appareil ou une adresse inconnus (adresse IP ${ctx.ip}, ${now.toISOString()}). Si ce n’était pas vous, prévenez immédiatement le super administrateur.`,
        }).catch(() => undefined);
    }
    return { token, sessionId: sid, expiresAt: absoluteExpiresAt.toISOString(), user: userService.adminProfile(user) };
}

/** Step 1. Same answer and timing for every refusal. */
export async function login(input: { email?: unknown; password?: unknown }, ctx: ReqCtx):
    Promise<{ step: 'totp' | 'email'; challengeId: string; codeSent?: boolean; retryAfterSeconds?: number }> {
    key(); // refuse early, before any password work, when the server is not configured
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 200) : '';
    const password = typeof input.password === 'string' ? input.password.slice(0, 200) : '';
    const user = email ? await userRepository.findByEmail(email, true) : null;
    const ok = await bcrypt.compare(password, user?.password || DUMMY_HASH);
    const a = user ? await AdminAuthModel.findOne({ userId: user._id }).lean() : null;

    if (!user || !user.password || !ok || !isStaff(user) || isLocked(a)) {
        if (user && isStaff(user) && !isLocked(a)) await recordFailure(user, ctx, 'password');
        else log.warn(`Admin sign-in refused for ${email || '(empty)'}: ${!user ? 'unknown email' : isLocked(a) ? 'locked' : !ok ? 'wrong password' : 'not staff'} (ip ${ctx.ip}).`);
        throw INVALID();
    }

    if (a?.totpSecretEnc) {
        return { step: 'totp', challengeId: await saveChallenge(user._id, 'totp', ctx.ip) };
    }
    // No authenticator yet: prove the mailbox first, then enrol.
    const issued = await userService.sendAdminEnrolmentCode(user);
    return { step: 'email', challengeId: await saveChallenge(user._id, 'email', ctx.ip), codeSent: issued.sent, retryAfterSeconds: issued.retryAfterSeconds };
}

/** First sign-in: the emailed code, then the account may enrol an authenticator. */
export async function verifyEmailCode(input: { challengeId?: unknown; code?: unknown }, ctx: ReqCtx): Promise<{ step: 'enroll'; challengeId: string }> {
    const c = await loadChallenge(input.challengeId, 'email');
    if (!c) throw INVALID();
    const user = await accountFor(c);
    if (!(await userService.consumeAdminEnrolmentCode(user, String(input.code ?? '')))) return failChallenge(c, user, ctx, 'email code');
    await AdminLoginChallengeModel.updateOne({ _id: c._id }, { $set: { stage: 'enroll', attempts: 0 } });
    return { step: 'enroll', challengeId: String(input.challengeId) };
}

/** One secret per challenge, whoever asks first (double click, React double effect). */
export async function enrollStart(input: { challengeId?: unknown }): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    const c = await loadChallenge(input.challengeId, 'enroll');
    if (!c) throw INVALID();
    const user = await accountFor(c);
    await AdminLoginChallengeModel.updateOne({ _id: c._id, secretEnc: null }, { $set: { secretEnc: encrypt(authenticator.generateSecret(20)) } });
    const fresh = await AdminLoginChallengeModel.findById(c._id).lean();
    if (!fresh?.secretEnc) throw INVALID();
    const secret = decrypt(fresh.secretEnc);
    const otpauthUrl = authenticator.keyuri(user.email, config.adminAuth.issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    return { otpauthUrl, qrDataUrl, secret };
}

export async function enrollConfirm(input: { challengeId?: unknown; code?: unknown }, ctx: ReqCtx): Promise<IssuedAdminSession & { backupCodes: string[] }> {
    const c = await loadChallenge(input.challengeId, 'enroll');
    if (!c || !c.secretEnc) throw INVALID();
    const user = await accountFor(c);
    const step = verifyTotp(decrypt(c.secretEnc), String(input.code ?? ''));
    if (step === null) return failChallenge(c, user, ctx, 'enrolment code');
    const { codes, hashes } = generateBackupCodes(10);
    await authOf(user._id);
    const r = await AdminAuthModel.updateOne(
        { userId: user._id, totpSecretEnc: null },
        { $set: { totpSecretEnc: c.secretEnc, totpEnrolledAt: new Date(), lastUsedStep: step, backupCodes: hashes.map(hash => ({ hash, usedAt: null })) } },
    );
    const del = await AdminLoginChallengeModel.deleteOne({ _id: c._id });
    if (r.modifiedCount !== 1 || del.deletedCount !== 1) throw INVALID();
    log.info(`Admin ${user.email} enrolled an authenticator (ip ${ctx.ip}).`);
    const session = await openSession(user, ctx, 'totp_enroll');
    return { ...session, backupCodes: codes };
}

/** Step 2: authenticator code, or a backup code (single use). */
export async function completeTotp(input: { challengeId?: unknown; code?: unknown; backupCode?: unknown }, ctx: ReqCtx): Promise<IssuedAdminSession & { backupCodesRemaining: number }> {
    const c = await loadChallenge(input.challengeId, 'totp');
    if (!c) throw INVALID();
    const user = await accountFor(c);
    const a = await AdminAuthModel.findOne({ userId: user._id });
    if (!a?.totpSecretEnc) { await AdminLoginChallengeModel.deleteOne({ _id: c._id }); throw INVALID(); }

    let method = 'totp';
    if (typeof input.backupCode === 'string' && input.backupCode.trim()) {
        const r = await AdminAuthModel.updateOne(
            { _id: a._id, backupCodes: { $elemMatch: { hash: hashBackup(input.backupCode), usedAt: null } } },
            { $set: { 'backupCodes.$.usedAt': new Date() } },
        );
        if (r.modifiedCount !== 1) return failChallenge(c, user, ctx, 'backup code');
        method = 'backup_code';
    } else {
        const step = verifyTotp(decrypt(a.totpSecretEnc), String(input.code ?? ''));
        if (step === null) return failChallenge(c, user, ctx, 'authenticator code');
        // A code is accepted once (replay), atomically.
        const r = await AdminAuthModel.updateOne(
            { _id: a._id, $or: [{ lastUsedStep: null }, { lastUsedStep: { $lt: step } }] },
            { $set: { lastUsedStep: step } },
        );
        if (r.modifiedCount !== 1) return failChallenge(c, user, ctx, 'code already used');
    }
    if ((await AdminLoginChallengeModel.deleteOne({ _id: c._id })).deletedCount !== 1) throw INVALID();
    const session = await openSession(user, ctx, method);
    const remaining = a.backupCodes.filter(b => !b.usedAt).length - (method === 'backup_code' ? 1 : 0);
    if (method === 'backup_code') {
        void notificationService.sendAccountEmail({
            userId: String(user._id), email: user.email,
            subject: 'SBC Admin : un code de secours a été utilisé',
            body: `Un code de secours vient d’être utilisé pour vous connecter à l’administration SBC (adresse IP ${ctx.ip}). Il vous en reste ${remaining}. Si ce n’était pas vous, prévenez immédiatement le super administrateur.`,
        }).catch(() => undefined);
    }
    return { ...session, backupCodesRemaining: remaining };
}

export type SessionState = 'active' | 'missing' | 'revoked' | 'idle' | 'expired';

/**
 * Is this admin session usable? Touches its activity (at most once a minute).
 * The gateway asks on every admin call (cached a minute).
 */
export async function checkSession(userId: string, sid: string): Promise<SessionState> {
    if (!Types.ObjectId.isValid(sid) || !Types.ObjectId.isValid(userId)) return 'missing';
    const s = await AdminSessionModel.findById(sid).lean();
    if (!s || String(s.userId) !== userId) return 'missing';
    if (s.revokedAt) return 'revoked';
    const now = Date.now();
    if (s.absoluteExpiresAt.getTime() <= now) { await revokeSession(sid, 'expired'); return 'expired'; }
    if (s.lastActivityAt.getTime() + config.adminAuth.idleTimeoutMs <= now) { await revokeSession(sid, 'idle'); return 'idle'; }
    if (now - s.lastActivityAt.getTime() > 60_000) {
        await AdminSessionModel.updateOne({ _id: sid, revokedAt: null }, { $set: { lastActivityAt: new Date(now) } });
    }
    return 'active';
}

export async function revokeSession(sid: string, reason: string): Promise<void> {
    if (!Types.ObjectId.isValid(sid)) return;
    await AdminSessionModel.updateOne({ _id: sid, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
    const r = await AdminSessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
    return r.modifiedCount;
}

/**
 * Super admin, for a lost phone: removes the authenticator and backup codes and
 * ends every session. The next sign-in goes through the emailed code and a new
 * enrolment.
 */
export async function resetAuthenticator(targetUserId: string, byUserId: string): Promise<{ sessionsEnded: number }> {
    await AdminAuthModel.updateOne(
        { userId: targetUserId },
        { $set: { totpSecretEnc: null, totpEnrolledAt: null, lastUsedStep: null, backupCodes: [], failures: 0, failuresSince: null, lockedUntil: null } },
    );
    await AdminLoginChallengeModel.deleteMany({ userId: targetUserId });
    const sessionsEnded = await revokeAllSessions(targetUserId, `authenticator reset by ${byUserId}`);
    log.warn(`Admin ${byUserId} reset the authenticator of ${targetUserId} (${sessionsEnded} session(s) ended).`);
    return { sessionsEnded };
}

/** The signed-in admin replaces their backup codes; needs a current authenticator code. */
export async function regenerateBackupCodes(userId: string, code: unknown): Promise<string[]> {
    const a = await AdminAuthModel.findOne({ userId });
    if (!a?.totpSecretEnc) throw INVALID();
    const step = verifyTotp(decrypt(a.totpSecretEnc), String(code ?? ''));
    if (step === null) throw INVALID();
    const { codes, hashes } = generateBackupCodes(10);
    const r = await AdminAuthModel.updateOne(
        { _id: a._id, $or: [{ lastUsedStep: null }, { lastUsedStep: { $lt: step } }] },
        { $set: { lastUsedStep: step, backupCodes: hashes.map(hash => ({ hash, usedAt: null })) } },
    );
    if (r.modifiedCount !== 1) throw INVALID();
    log.info(`Admin ${userId} replaced their backup codes.`);
    return codes;
}

/** What the team screen shows per account. */
export async function securityStatus(userIds: string[]): Promise<Record<string, { authenticator: boolean; backupCodesLeft: number; lastLoginAt: Date | null; locked: boolean }>> {
    const rows = await AdminAuthModel.find({ userId: { $in: userIds } }).lean();
    const out: Record<string, { authenticator: boolean; backupCodesLeft: number; lastLoginAt: Date | null; locked: boolean }> = {};
    for (const id of userIds) out[id] = { authenticator: false, backupCodesLeft: 0, lastLoginAt: null, locked: false };
    for (const r of rows) {
        out[String(r.userId)] = {
            authenticator: !!r.totpSecretEnc,
            backupCodesLeft: r.backupCodes.filter(b => !b.usedAt).length,
            lastLoginAt: r.lastLoginAt,
            locked: isLocked(r),
        };
    }
    return out;
}
