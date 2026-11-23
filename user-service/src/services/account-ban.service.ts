/**
 * Account suspension (Sterling / Rufus, 2026-11-23): a member with NO filleul who asks for a
 * withdrawal while holding "unexplained money" is suspended on the spot.
 *
 * "Unexplained money" is either:
 *   (a) balance A (users.balance / usdBalance) above B (opening balance + recorded movements)
 *       by more than 1 XAF / 0.01 USD, the nightly ledger check's formula (blnk-sync tripleCheck);
 *   (b) referral-commission credits in the journal (walletmovements source `commission`), which
 *       a member without filleuls cannot have earned. Commissions support already took back
 *       (`commission-reversal` debits) are subtracted.
 * Money from legitimate sources (WhatsApp views, transfers, events, leaderboard bonus, refunds,
 * admin adjustments, deposits) is fine as long as the balance is fully explained.
 *
 * Only role `user`. "No filleul" = no referrals row at all with `referrer` = the member
 * (archived rows count as filleuls: the rule must never fire on a doubt).
 *
 * NO_REFERRAL_BAN=off|log|enforce (default off):
 *   off      nothing is evaluated.
 *   log      evaluated and reported (logs; payment-service opens a warning case), never banned.
 *   enforce  the account is banned: `blocked: true` + `ban`, every session ended, Redis flag.
 * payment-service reads the same variable (fail closed in enforce when this service cannot answer).
 *
 * A banned member gets 403 `{ success:false, code:'ACCOUNT_BANNED', message }` on sign-in (after
 * the password matched), session refresh, GET /users/me and every authenticated member route,
 * and on any withdrawal (lock reason `account_banned`).
 */
import { Types } from 'mongoose';
import UserModel, { IAccountBan, UserRole } from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import WalletMovementModel, { WALLET_FIELDS, WalletMovementDirection, WalletMovementStatus } from '../database/models/wallet-movement.model';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';
import { MemberSessionModel } from '../database/models/member-session.model';
import { SessionKeyModel } from '../database/models/session-key.model';
import { rkey, withRedis } from '../utils/redis';
import logger from '../utils/logger';

const log = logger.getLogger('AccountBan');

export type NoReferralBanMode = 'off' | 'log' | 'enforce';
export const noReferralBanMode = (): NoReferralBanMode => {
    const m = String(process.env.NO_REFERRAL_BAN || 'off').trim().toLowerCase();
    return m === 'log' || m === 'enforce' ? m : 'off';
};

/** What every member-facing refusal says (member app contract: 403 + code ACCOUNT_BANNED). */
export const ACCOUNT_BANNED_CODE = 'ACCOUNT_BANNED';
export const ACCOUNT_BANNED_MESSAGE = 'Votre compte a été suspendu par mesure de sécurité. Pour en savoir plus, contactez le support SBC avec « Signaler un problème » depuis la page de connexion.';
export const bannedBody = () => ({ success: false, code: ACCOUNT_BANNED_CODE, message: ACCOUNT_BANNED_MESSAGE });

export class AccountBannedError extends Error {
    readonly statusCode = 403;
    readonly code = ACCOUNT_BANNED_CODE;
    constructor() { super(ACCOUNT_BANNED_MESSAGE); }
}

/** Journal sources that mean a referral commission (payment-service processDeposit: commissionLevel set → 'commission'). */
export const REFERRAL_COMMISSION_SOURCES = ['commission'];
const COMMISSION_REVERSAL_SOURCES = ['commission-reversal'];
const TOLERANCE: Record<'XAF' | 'USD', number> = { XAF: 1, USD: 0.01 };
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Redis flag (fail open; the database stays the truth where it is read anyway) ──────────

const FLAG_TTL_S = 30 * 86400; // longer than any member token (JWT_EXPIRATION 1d, cookie session 1d)
const flagKey = (userId: string) => rkey(`ban:${userId}`);

export async function setBanFlag(userId: string): Promise<boolean> {
    return withRedis('ban-flag:set', false, async (r) => (await r.set(flagKey(userId), '1', 'EX', FLAG_TTL_S)) === 'OK');
}
export async function clearBanFlag(userId: string): Promise<boolean> {
    return withRedis('ban-flag:clear', false, async (r) => (await r.del(flagKey(userId))) >= 0);
}
/** true when the flag is set; false when not set OR Redis is off/down (fail open). */
export async function hasBanFlag(userId: string): Promise<boolean> {
    if (!/^[a-f0-9]{24}$/i.test(userId)) return false;
    return withRedis('ban-flag:get', false, async (r) => (await r.exists(flagKey(userId))) === 1);
}

export const isBanned = (u: { ban?: { at?: Date | null } | null } | null | undefined): boolean => !!u?.ban?.at;

// ─── Evaluation ──────────────────────────────────────────────────────────────────────────

export interface BalanceCheck {
    currency: 'XAF' | 'USD';
    a: number;
    b: number | null;
    /** a - b (positive = more money than the journal explains). */
    diff: number | null;
    /** false: B cannot be trusted for this member (no opening snapshot yet, or a movement in flight). */
    decidable: boolean;
    note?: 'no_snapshot' | 'pending_movement';
    unexplained: boolean;
}

export interface NoReferralEvaluation {
    applicable: boolean;
    /** Why the rule does not apply ('not_member', 'has_referrals'). */
    skipped?: string;
    hasReferrals: boolean;
    suspicious: boolean;
    reasons: ('unexplained_balance' | 'commission_without_referrals')[];
    details: {
        /** The first balance found unexplained (else XAF), with its A and B. */
        currency: 'XAF' | 'USD';
        a: number;
        b: number | null;
        commissionCredits: number;
        commissionReversed: number;
        commissionCreditsUsd: number;
        balances: BalanceCheck[];
    };
}

/** Earliest opening snapshot per currency: a member created before it, with no opening row, cannot be judged. */
const earliestSnapshot = new Map<string, { at: number; value: Date | null }>();
async function firstSnapshotAt(currency: 'XAF' | 'USD'): Promise<Date | null> {
    const hit = earliestSnapshot.get(currency);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    const row = await WalletOpeningBalanceModel.findOne({ currency }).sort({ snapshotAt: 1 }).select('snapshotAt').lean();
    const value = row?.snapshotAt ? new Date(row.snapshotAt) : null;
    earliestSnapshot.set(currency, { at: Date.now(), value });
    return value;
}
/** Tests only. */
export const _resetSnapshotCache = () => earliestSnapshot.clear();

async function balanceCheck(userId: Types.ObjectId, user: any, currency: 'XAF' | 'USD'): Promise<BalanceCheck> {
    const a = round2(Number(user?.[WALLET_FIELDS[currency]] ?? 0));
    const [opening, pending] = await Promise.all([
        WalletOpeningBalanceModel.findOne({ userId, currency }).lean(),
        WalletMovementModel.countDocuments({ userId, currency, status: WalletMovementStatus.PENDING }),
    ]);
    if (!opening) {
        // No opening row: fine for a member created after the first snapshot (started at 0, every
        // movement is journalled); anyone older, or no snapshot at all, cannot be judged.
        const first = await firstSnapshotAt(currency);
        const createdAt = user?.createdAt ? new Date(user.createdAt) : null;
        if (!first || !createdAt || createdAt < first) {
            return { currency, a, b: null, diff: null, decidable: false, note: 'no_snapshot', unexplained: false };
        }
    }
    const since = opening?.snapshotAt ? new Date(opening.snapshotAt) : null;
    const net = await WalletMovementModel.aggregate([
        { $match: { userId, currency, status: WalletMovementStatus.APPLIED, ...(since ? { appliedAt: { $gt: since } } : {}) } },
        { $group: { _id: null, net: { $sum: { $cond: [{ $eq: ['$direction', WalletMovementDirection.CREDIT] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
    ]);
    const b = round2(Number(opening?.amount ?? 0) + Number(net[0]?.net ?? 0));
    const diff = round2(a - b);
    // A movement between its claim and its APPLIED mark makes A run ahead of B for an instant: never judge then.
    if (pending > 0) return { currency, a, b, diff, decidable: false, note: 'pending_movement', unexplained: false };
    return { currency, a, b, diff, decidable: true, unexplained: diff > TOLERANCE[currency] };
}

async function commissionTotals(userId: Types.ObjectId) {
    const rows = await WalletMovementModel.aggregate([
        {
            $match: {
                userId, currency: { $in: ['XAF', 'USD'] }, status: WalletMovementStatus.APPLIED,
                $or: [
                    { direction: WalletMovementDirection.CREDIT, source: { $in: REFERRAL_COMMISSION_SOURCES } },
                    { direction: WalletMovementDirection.DEBIT, source: { $in: COMMISSION_REVERSAL_SOURCES } },
                    { direction: WalletMovementDirection.DEBIT, reference: { $regex: '^commission-reversal:' } },
                ],
            },
        },
        { $group: { _id: { c: '$currency', d: '$direction' }, total: { $sum: '$amount' } } },
    ]);
    const get = (c: string, d: string) => round2(Number(rows.find((r: any) => r._id.c === c && r._id.d === d)?.total ?? 0));
    return {
        credits: get('XAF', 'CREDIT'), reversed: get('XAF', 'DEBIT'),
        creditsUsd: get('USD', 'CREDIT'), reversedUsd: get('USD', 'DEBIT'),
    };
}

/** Evaluates the rule (reads only). */
export async function evaluateNoReferralRule(userIdIn: string): Promise<NoReferralEvaluation | null> {
    const userId = new Types.ObjectId(userIdIn);
    const user: any = await UserModel.findById(userId).select('role balance usdBalance createdAt ban blocked').lean();
    if (!user) return null;
    const empty = (skipped: string, hasReferrals: boolean): NoReferralEvaluation => ({
        applicable: false, skipped, hasReferrals, suspicious: false, reasons: [],
        details: { currency: 'XAF', a: round2(Number(user.balance ?? 0)), b: null, commissionCredits: 0, commissionReversed: 0, commissionCreditsUsd: 0, balances: [] },
    });
    if (user.role !== UserRole.USER) return empty('not_member', false);
    const hasReferrals = !!(await ReferralModel.exists({ referrer: userId }));
    if (hasReferrals) return empty('has_referrals', true);

    const [xaf, usd, com] = await Promise.all([
        balanceCheck(userId, user, 'XAF'), balanceCheck(userId, user, 'USD'), commissionTotals(userId),
    ]);
    const reasons: NoReferralEvaluation['reasons'] = [];
    if (xaf.unexplained || usd.unexplained) reasons.push('unexplained_balance');
    const netCommission = round2(com.credits - com.reversed) > TOLERANCE.XAF || round2(com.creditsUsd - com.reversedUsd) > TOLERANCE.USD;
    if (netCommission) reasons.push('commission_without_referrals');
    const first = [xaf, usd].find((c) => c.unexplained) ?? xaf;
    return {
        applicable: true, hasReferrals: false, suspicious: reasons.length > 0, reasons,
        details: {
            currency: first.currency, a: first.a, b: first.b,
            commissionCredits: com.credits, commissionReversed: com.reversed, commissionCreditsUsd: com.creditsUsd,
            balances: [xaf, usd],
        },
    };
}

// ─── Ban / unban ─────────────────────────────────────────────────────────────────────────

/**
 * Suspends the account: one conditional write (`ban` absent → set, with `blocked: true`), so two
 * withdrawals at once ban once. Then ends every session and sets the Redis flag.
 * Returns the ban in force (the existing one when it was already banned) and whether this call set it.
 */
export async function banAccount(userIdIn: string, input: { reason: IAccountBan['reason']; by: string; details?: Record<string, unknown> | null }):
    Promise<{ ban: IAccountBan; created: boolean } | null> {
    const userId = new Types.ObjectId(userIdIn);
    const ban: IAccountBan = { at: new Date(), reason: input.reason, by: String(input.by).slice(0, 120), details: input.details ?? null };
    const before: any = await UserModel.findOneAndUpdate(
        { _id: userId, 'ban.at': { $exists: false } },
        { $set: { ban, blocked: true } },
        { new: false, projection: { blocked: 1 } },
    ).lean();
    if (!before) {
        const current: any = await UserModel.findById(userId).select('ban').lean();
        if (!current) return null;
        if (current.ban?.at) { await setBanFlag(userIdIn); return { ban: current.ban, created: false }; }
        return null;
    }
    if (before.blocked === true) {
        // Blocked by an admin already: lifting the ban later must keep it blocked.
        await UserModel.updateOne({ _id: userId, 'ban.at': ban.at }, { $set: { 'ban.blockedBefore': true } });
        ban.blockedBefore = true;
    }
    await endAllSessions(userId, 'banned');
    await setBanFlag(userIdIn);
    log.warn(`Account ${userIdIn} BANNED (${input.reason}) by ${ban.by}: ${JSON.stringify(input.details ?? {}).slice(0, 500)}`);
    return { ban, created: true };
}

/** Every way back in: cookie sessions (refresh tokens), browser keys bound to tokens, the stored token. */
export async function endAllSessions(userId: Types.ObjectId, reason: string): Promise<{ sessions: number }> {
    const now = new Date();
    const [s] = await Promise.all([
        MemberSessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now, revokedReason: reason } }),
        SessionKeyModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } }),
        UserModel.updateOne({ _id: userId }, { $unset: { token: 1 } }),
    ]);
    return { sessions: s.modifiedCount };
}

export class BanError extends Error {
    constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

/** Lifts the ban (support « Lever la suspension »): the ban moves to banHistory, the flag is cleared. */
export async function unbanAccount(userIdIn: string, input: { by: unknown; reason: unknown }) {
    const by = typeof input.by === 'string' ? input.by.trim().slice(0, 120) : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
    if (!by) throw new BanError(400, 'INVALID_INPUT', 'by is required.');
    if (reason.length < 5) throw new BanError(400, 'REASON_REQUIRED', 'A reason is required.');
    const userId = new Types.ObjectId(userIdIn);
    const current: any = await UserModel.findById(userId).select('ban').lean();
    if (!current) throw new BanError(404, 'USER_NOT_FOUND', 'Membre introuvable.');
    if (!current.ban?.at) throw new BanError(409, 'NOT_BANNED', 'Ce compte n’est pas suspendu.');
    const liftedAt = new Date();
    const r = await UserModel.updateOne(
        { _id: userId, 'ban.at': current.ban.at },
        {
            $set: { blocked: current.ban.blockedBefore === true },
            $unset: { ban: 1 },
            $push: { banHistory: { ...current.ban, liftedAt, liftedBy: by, liftReason: reason } },
        },
    );
    if (r.modifiedCount !== 1) throw new BanError(409, 'STATE_CHANGED', 'La suspension a changé entre-temps : rechargez la fiche.');
    await clearBanFlag(userIdIn);
    log.warn(`Account ${userIdIn} UNBANNED by ${by}: ${reason.slice(0, 200)}`);
    return { unbanned: true, liftedAt, stillBlocked: current.ban.blockedBefore === true };
}

// ─── The withdrawal check (payment-service, before any member payout) ─────────────────────

export interface WithdrawalBanCheck {
    mode: NoReferralBanMode;
    suspicious: boolean;
    banned: boolean;
    /** Banned before this call (the ban in force is returned in `ban`). */
    alreadyBanned: boolean;
    reasons: NoReferralEvaluation['reasons'];
    details: NoReferralEvaluation['details'] | null;
    ban: { at: string; reason: string } | null;
}

export async function withdrawalBanCheck(userIdIn: string, ctx: { amount?: unknown; currency?: unknown; transactionId?: unknown; dryRun?: boolean } = {}):
    Promise<WithdrawalBanCheck | null> {
    const mode = noReferralBanMode();
    const current: any = await UserModel.findById(userIdIn).select('ban').lean();
    if (!current) return null;
    if (current.ban?.at) {
        return { mode, suspicious: true, banned: true, alreadyBanned: true, reasons: [], details: current.ban.details?.evaluation ?? null,
            ban: { at: new Date(current.ban.at).toISOString(), reason: current.ban.reason } };
    }
    if (mode === 'off') return { mode, suspicious: false, banned: false, alreadyBanned: false, reasons: [], details: null, ban: null };
    const ev = await evaluateNoReferralRule(userIdIn);
    if (!ev) return null;
    const base = { mode, suspicious: ev.suspicious, alreadyBanned: false, reasons: ev.reasons, details: ev.details };
    if (!ev.suspicious) return { ...base, banned: false, ban: null };
    const attempt = {
        amount: Number.isFinite(Number(ctx.amount)) ? Number(ctx.amount) : null,
        currency: typeof ctx.currency === 'string' ? ctx.currency.slice(0, 8) : null,
        transactionId: typeof ctx.transactionId === 'string' ? ctx.transactionId.slice(0, 100) : null,
    };
    if (mode !== 'enforce' || ctx.dryRun) {
        log.warn(`No-referral rule (${ctx.dryRun ? 'dry run' : mode}) user ${userIdIn}: WOULD BAN (${ev.reasons.join(', ')}) ${JSON.stringify(ev.details.balances.map((c) => [c.currency, c.a, c.b]))} commissions ${ev.details.commissionCredits}`);
        return { ...base, banned: false, ban: null };
    }
    const r = await banAccount(userIdIn, { reason: 'no_referral_withdrawal', by: 'system:no-referral-rule', details: { reasons: ev.reasons, evaluation: ev.details, attempt } });
    if (!r) return null;
    return { ...base, banned: true, alreadyBanned: !r.created, ban: { at: r.ban.at.toISOString(), reason: r.ban.reason } };
}
