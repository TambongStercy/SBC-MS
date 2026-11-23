/**
 * Email verified after payment, not at sign-up (Sterling, 2026-11-23).
 *
 * The code at sign-up lost people before they paid (signup-attempts `code_not_received` /
 * `never_verified`). Now:
 *   - sign-up opens the session at once, without a code;
 *   - while the account is unpaid and unverified, signing in needs the password only
 *     (nothing to steal yet: no pack ever, no balance); once paid or verified, every
 *     sign-in sends a code as before;
 *   - once paid, the member app shows a blocking screen until the email is verified
 *     (POST /users/me/verify-email/request|confirm), and lets a mistyped address be
 *     corrected first (…/correct, password required, only while unverified).
 * Annonceur sign-ups (no pack to pay) keep the code at sign-up, as before.
 * SIGNUP_EMAIL_CODE=at_signup goes back to the code at sign-up for everyone.
 */
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import UserModel, { IUser } from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import { userRepository } from '../database/repositories/user.repository';
import { notificationService, DeliveryChannel } from './clients/notification.service.client';
import { AppError } from '../utils/errors';
import { OTP_REUSE_MIN_REMAINING_MS, otpMatches, otpSendDecision } from '../utils/otp.utils';
import logger from '../utils/logger';

const log = logger.getLogger('EmailVerification');
const PURPOSE = 'verifyEmail' as const;
const CODE_MINUTES = 10;

export const signupEmailCodeMode = (): 'after_payment' | 'at_signup' =>
    String(process.env.SIGNUP_EMAIL_CODE || '').toLowerCase() === 'at_signup' ? 'at_signup' : 'after_payment';

/** Ever had a pack (any subscription document, active or not). */
export async function hasEverSubscribed(userId: unknown): Promise<boolean> {
    return !!(await SubscriptionModel.exists({ user: new Types.ObjectId(String(userId)) }));
}

type AccessUser = Pick<IUser, '_id' | 'isVerified' | 'role' | 'balance'> & {
    signupIntent?: string | null; usdBalance?: number | null; activationBalance?: number | null;
};

/** Signs in (and finishes sign-up) without a code: an unpaid, unverified member with nothing at stake. */
export async function codeFreeAccess(user: AccessUser): Promise<boolean> {
    if (signupEmailCodeMode() !== 'after_payment') return false;
    if (user.isVerified) return false;
    if (user.signupIntent === 'annonceur') return false;
    if (user.role && String(user.role) !== 'user') return false;
    if ((user.balance || 0) > 0 || (user.usdBalance || 0) > 0 || (user.activationBalance || 0) > 0) return false;
    return !(await hasEverSubscribed(user._id));
}

const emailOf = (u: { email?: string | null }) => String(u.email || '').trim().toLowerCase();

async function activeUser(userId: string | Types.ObjectId, withPassword = false) {
    const q = UserModel.findById(userId);
    const user = await (withPassword ? q.select('+password') : q);
    if (!user || user.blocked || user.deleted) throw new AppError('User account is inactive or not found.', 403);
    return user;
}

export interface VerificationSent { alreadyVerified: boolean; sent: boolean; sentTo: string | null; retryAfterSeconds: number }

const mask = (email: string) => {
    const [name, domain] = email.split('@');
    return name && domain ? `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}` : email;
};

/** Sends (or sends again) the code to the account's own email, never another channel. */
export async function requestEmailVerification(userId: string | Types.ObjectId): Promise<VerificationSent> {
    const user = await activeUser(userId);
    const email = emailOf(user);
    if (user.isVerified) return { alreadyVerified: true, sent: false, sentTo: null, retryAfterSeconds: 0 };
    if (!email) throw new AppError('Votre compte n’a pas d’adresse e-mail : contactez le support.', 400);

    const now = new Date();
    if (!(await userRepository.reserveOtpSend(user._id, now))) {
        const fresh = await userRepository.findById(user._id);
        const { retryAfterSeconds } = otpSendDecision(fresh?.otpSendLog, now);
        return { alreadyVerified: false, sent: false, sentTo: mask(email), retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }
    // A code still comfortably valid is sent again rather than replaced (a late e-mail and a new one agree).
    const live = (user.otps || []).find(o => o.purpose === PURPOSE && o.target === email
        && new Date(o.expiration).getTime() - now.getTime() >= OTP_REUSE_MIN_REMAINING_MS);
    let code: string; let minutes = CODE_MINUTES;
    if (live) {
        code = live.code;
        minutes = Math.floor((new Date(live.expiration).getTime() - now.getTime()) / 60000);
    } else {
        const svc = (await import('./user.service')).userService;
        code = await svc.generateAndStoreOtp(user._id, 'otps', CODE_MINUTES, { purpose: PURPOSE, target: email });
    }
    await notificationService.sendOtp({
        userId: String(user._id), recipient: email, channel: DeliveryChannel.EMAIL, code, expireMinutes: minutes,
        isRegistration: true, purpose: PURPOSE, userName: user.name, language: user.language?.[0] || 'fr',
    });
    log.info(`Email verification code sent for user ${user._id}.`);
    return { alreadyVerified: false, sent: true, sentTo: mask(email), retryAfterSeconds: 60 };
}

/** The code received → the email is verified. */
export async function confirmEmailVerification(userId: string | Types.ObjectId, rawCode: unknown): Promise<{ verified: true }> {
    const user = await activeUser(userId);
    if (user.isVerified) return { verified: true };
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const email = emailOf(user);
    const now = new Date();
    const ok = !!code && (user.otps || []).some(o => o.purpose === PURPOSE && o.target === email
        && new Date(o.expiration) > now && otpMatches(o.code, code));
    if (!ok) throw new AppError('Code invalide ou expiré. Utilisez le dernier code reçu.', 400);
    await UserModel.updateOne(
        { _id: user._id, email: user.email },
        { $set: { isVerified: true }, $pull: { otps: { purpose: PURPOSE } } },
    );
    log.info(`Email verified for user ${user._id}.`);
    return { verified: true };
}

/** A mistyped address, corrected before it was ever verified (password required), then a code to it. */
export async function correctUnverifiedEmail(
    userId: string | Types.ObjectId,
    input: { email?: unknown; password?: unknown },
    isValidEmailDomain: (email: string) => boolean,
): Promise<VerificationSent> {
    const user = await activeUser(userId, true);
    if (user.isVerified) throw new AppError('Votre adresse est déjà vérifiée : changez-la depuis votre profil.', 409);
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!email || !isValidEmailDomain(email)) {
        throw new AppError('Adresse e-mail invalide. Utilisez une adresse Gmail, Yahoo, Outlook, Hotmail ou iCloud.', 400);
    }
    const password = typeof input.password === 'string' ? input.password : '';
    if (!password || !user.password || !(await bcrypt.compare(password, user.password))) {
        throw new AppError('Mot de passe incorrect.', 400);
    }
    if (email === emailOf(user)) return requestEmailVerification(user._id);
    const taken = await userRepository.findByEmail(email);
    if (taken && String(taken._id) !== String(user._id)) {
        throw new AppError('Cette adresse e-mail est déjà utilisée par un autre compte.', 409);
    }
    const r = await UserModel.updateOne(
        { _id: user._id, isVerified: { $ne: true }, email: user.email },
        { $set: { email }, $pull: { otps: { purpose: PURPOSE } } },
    );
    if (r.modifiedCount !== 1) throw new AppError('Le compte a changé entre-temps. Recommencez.', 409);
    log.info(`Unverified email corrected for user ${user._id} (now ${mask(email)}).`);
    return requestEmailVerification(user._id);
}

/**
 * Who gets the blocking screen after paying: accounts created from EMAIL_VERIFY_GATE_SINCE
 * (default 2026-11-23, when sign-up stopped asking for the code). On prod 22,181 of the
 * 63,610 active subscribers were unverified that day (older sign-ups): they are not
 * blocked; their next e-mailed sign-in code verifies them as before.
 */
export const emailGateSince = (): Date => {
    const d = new Date(process.env.EMAIL_VERIFY_GATE_SINCE || '2026-11-23T00:00:00Z');
    return Number.isNaN(d.getTime()) ? new Date('2026-11-23T00:00:00Z') : d;
};

export function needsEmailVerification(user: { isVerified?: boolean; createdAt?: Date | string | null }, activeSubscriptionCount: number): boolean {
    if (signupEmailCodeMode() !== 'after_payment' || user.isVerified || activeSubscriptionCount <= 0) return false;
    const created = user.createdAt ? new Date(user.createdAt) : null;
    return !!created && created.getTime() >= emailGateSince().getTime();
}
