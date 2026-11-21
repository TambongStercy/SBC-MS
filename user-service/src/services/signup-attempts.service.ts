import { Types } from 'mongoose';
import type { Request } from 'express';
import { ISignupAttempt, SignupAttemptModel, SignupOutcome, SignupSource, SignupStep } from '../database/models/signup-attempt.model';
import { doualaDay } from './activity-signals.service';
import { normalizeCountryName, normalizePhoneNumber } from '../utils/phone.utils';
import { maskEmail, maskPhone } from '../utils/mask-email';
import { notificationService } from './clients/notification.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('SignupAttempts');

/**
 * Security plan Phase 11: every sign-up form sent is recorded with what became
 * of it. One buffered insert per attempt, written after the response (never on
 * the request's critical path); the later steps (code entered, wrong code,
 * closed after 24 h) are single conditional updates.
 *
 *   started = completed + failed + in progress, for every day and country,
 * because each attempt has exactly one outcome at any time.
 */

export type FailureGroup = 'sbc_code' | 'provider_api' | 'member' | 'unknown';

/** Why a sign-up did not finish, and whose side it is on (same groups as payments). */
export const SIGNUP_REASONS: Record<string, { group: FailureGroup; label: string }> = {
    phone_or_email_used: { group: 'member', label: 'Numéro ou email déjà utilisé' },
    invalid_sponsor_code: { group: 'member', label: 'Code parrain invalide' },
    no_sponsor_code: { group: 'member', label: 'Pas de code parrain' },
    sponsor_blocked: { group: 'member', label: 'Parrain bloqué' },
    invalid_phone: { group: 'member', label: 'Numéro invalide pour le pays' },
    invalid_email_domain: { group: 'member', label: 'Adresse email refusée' },
    invalid_form: { group: 'member', label: 'Formulaire incomplet ou invalide' },
    antibot_failed: { group: 'member', label: 'Contrôle anti-robot échoué' },
    wrong_code: { group: 'member', label: 'Code erroné, jamais validé' },
    never_verified: { group: 'member', label: 'Code reçu, jamais saisi (24 h)' },
    code_not_received: { group: 'provider_api', label: 'Code non reçu (envoi échoué)' },
    server_error: { group: 'sbc_code', label: 'Erreur serveur' },
};

export const reasonGroup = (reason: string | null | undefined): FailureGroup =>
    (reason && SIGNUP_REASONS[reason]?.group) || 'unknown';

const RETENTION_DAYS = 180;
/** An attempt whose code was never entered is closed after this long. */
export const VERIFY_WINDOW_MS = 24 * 3600 * 1000;
const FLUSH_MS = 1000;
const FLUSH_SIZE = 200;
const HARD_CAP = 5000;

/** Classifies a registration error (registerUser throws plain Errors). */
export function classifySignupError(err: unknown): { reason: string; step: SignupStep; detail: string | null } {
    const e = err as { message?: string; code?: number; name?: string } | null;
    const msg = String(e?.message || '');
    const m = (re: RegExp) => re.test(msg);
    if (e?.code === 11000 || m(/already exists/i)) return { reason: 'phone_or_email_used', step: 'form', detail: null };
    if (m(/Invalid referrer code/i)) return { reason: 'invalid_sponsor_code', step: 'form', detail: null };
    if (m(/sans un code de parrainage|No referrer code/i)) return { reason: 'no_sponsor_code', step: 'form', detail: null };
    if (m(/Referrer is blocked/i)) return { reason: 'sponsor_blocked', step: 'form', detail: null };
    if (m(/Invalid email domain/i)) return { reason: 'invalid_email_domain', step: 'form', detail: null };
    if (m(/Missing required registration fields|must be an array|must be a string/i) || e?.name === 'ValidationError' || e?.name === 'CastError') {
        return { reason: 'invalid_form', step: 'form', detail: msg.slice(0, 160) || null };
    }
    return { reason: 'server_error', step: 'server', detail: msg.slice(0, 160) || e?.name || null };
}

const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v || '').toString().trim();
};

/** The typed number with its dialling code (as stored at sign-up), masked; never the full number. */
function maskedPhone(raw: unknown, country: string): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let full: string | null = null;
    try { full = country !== 'XX' ? normalizePhoneNumber(raw, country) : null; } catch { full = null; }
    if (full) return maskPhone(full);
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 4 ? `•••• ${digits.slice(-3)}` : '•••';
}

/** The request's facts that every attempt records, whatever its outcome. */
export function signupContext(req: Request, now: Date = new Date()) {
    const body = (req.body || {}) as Record<string, unknown>;
    const geo = header(req, 'x-sbc-geo').toUpperCase();
    const geoCountry = /^[A-Z]{2}$/.test(geo) && geo !== 'XX' && geo !== 'T1' ? geo : null;
    const declared = typeof body.country === 'string' ? normalizeCountryName(body.country) : '';
    const country = /^[A-Z]{2}$/.test(declared) ? declared : geoCountry || 'XX';
    const client = header(req, 'x-sbc-client');
    const source: SignupSource = client === 'web' || client === 'app' ? client : 'api';
    const sponsor = (body.referrerCode || body.referralCode) as unknown;
    const requestId = header(req, 'x-request-id');
    return {
        day: doualaDay(now),
        startedAt: now,
        country,
        geoCountry,
        source,
        emailMasked: typeof body.email === 'string' && body.email.includes('@') ? maskEmail(body.email) : null,
        phoneMasked: maskedPhone(body.phoneNumber, country),
        sponsorCode: typeof sponsor === 'string' && sponsor.trim() ? sponsor.trim().slice(0, 40) : null,
        annonceur: body.signupIntent === 'annonceur',
        requestId: /^[A-Za-z0-9._:-]{1,80}$/.test(requestId) ? requestId : null,
    };
}

type AttemptDoc = Partial<ISignupAttempt> & { _id: Types.ObjectId };

// ---- buffered inserts ------------------------------------------------------

const pending = new Map<string, AttemptDoc>();
const pendingByUser = new Map<string, string>();
/** Users whose attempt was just written: a completion that races the insert is retried. */
const recentlyFlushed = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;
export const signupStats = { recorded: 0, flushed: 0, dropped: 0, flushErrors: 0 };

async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending.size) return;
    const docs = [...pending.values()];
    pending.clear();
    pendingByUser.clear();
    const at = Date.now();
    for (const [k, t] of recentlyFlushed) if (at - t > 60_000) recentlyFlushed.delete(k);
    for (const d of docs) if (d.userId) recentlyFlushed.set(String(d.userId), at);
    try {
        await SignupAttemptModel.insertMany(docs, { ordered: false });
        signupStats.flushed += docs.length;
    } catch (err: any) {
        signupStats.flushErrors++;
        log.warn(`Signup attempts flush: ${err?.message ?? err}`);
    }
}

const schedule = () => {
    if (pending.size >= FLUSH_SIZE) { void flush(); return; }
    if (!timer) { timer = setTimeout(() => { void flush(); }, FLUSH_MS); timer.unref?.(); }
};

/** Writes what is still buffered (tests, shutdown). */
export const flushSignupAttempts = flush;

/** Records one sign-up attempt. Never throws, never awaits the database. */
export function recordSignupAttempt(
    ctx: ReturnType<typeof signupContext>,
    result: { userId: string } | { error: unknown } | { reason: string; step: SignupStep; detail?: string | null },
): void {
    try {
        if (pending.size >= HARD_CAP) { signupStats.dropped++; return; }
        const _id = new Types.ObjectId();
        const base: AttemptDoc = {
            _id, ...ctx, wrongCodes: 0, delivery: [],
            expiresAt: new Date(ctx.startedAt.getTime() + RETENTION_DAYS * 86400 * 1000),
        };
        let doc: AttemptDoc;
        if ('userId' in result) {
            doc = { ...base, outcome: 'in_progress', step: 'code', userId: new Types.ObjectId(result.userId) };
            pendingByUser.set(result.userId, String(_id));
        } else {
            const f = 'error' in result ? classifySignupError(result.error) : { reason: result.reason, step: result.step, detail: result.detail ?? null };
            doc = { ...base, outcome: 'failed', step: f.step, reason: f.reason, detail: f.detail, failedAt: ctx.startedAt };
        }
        pending.set(String(_id), doc);
        signupStats.recorded++;
        schedule();
    } catch (err: any) {
        log.warn(`Signup attempt not recorded: ${err?.message ?? err}`);
    }
}

/**
 * The member entered their code: their sign-up is complete. Also called on
 * every later sign-in, where it matches nothing. A sign-up closed as failed
 * after 24 h and completed later moves to completed (still one outcome).
 */
export function markSignupCompleted(userId: string, now: Date = new Date()): void {
    if (!Types.ObjectId.isValid(userId)) return;
    const buffered = pendingByUser.get(userId);
    const doc = buffered ? pending.get(buffered) : undefined;
    if (doc) {
        if (doc.outcome === 'in_progress') Object.assign(doc, { outcome: 'completed', completedAt: now });
        return;
    }
    const apply = () => SignupAttemptModel.updateOne(
        { userId: new Types.ObjectId(userId), $or: [{ outcome: 'in_progress' }, { outcome: 'failed', step: 'code' }] },
        { $set: { outcome: 'completed', completedAt: now, reason: null, failedAt: null } },
    );
    apply()
        .then(r => {
            // The insert may still be in flight (attempt written less than a minute ago).
            if (!r.matchedCount && recentlyFlushed.has(userId)) setTimeout(() => { apply().catch(() => undefined); }, 3000).unref?.();
        })
        .catch((err: any) => log.warn(`Signup completion not recorded for ${userId}: ${err?.message ?? err}`));
}

/** A wrong (or expired) code typed during sign-up. */
export function markSignupWrongCode(userId: string): void {
    if (!Types.ObjectId.isValid(userId)) return;
    const buffered = pendingByUser.get(userId);
    const doc = buffered ? pending.get(buffered) : undefined;
    if (doc) { doc.wrongCodes = (doc.wrongCodes || 0) + 1; return; }
    SignupAttemptModel.updateOne(
        { userId: new Types.ObjectId(userId), outcome: 'in_progress' },
        { $inc: { wrongCodes: 1 } },
    ).catch((err: any) => log.warn(`Signup wrong code not recorded for ${userId}: ${err?.message ?? err}`));
}

// ---- closing attempts never verified --------------------------------------

/**
 * Closes the attempts whose code was not entered within 24 h, with the reason
 * proven from notification-service's delivery records: no channel sent the
 * code → code_not_received (provider); wrong codes typed → wrong_code;
 * otherwise never_verified (gave up). When notification-service does not
 * answer, waits, and after 48 h closes as never_verified (detail
 * delivery_unknown). Returns the days whose figures changed.
 */
export async function closeUnverifiedAttempts(now: Date = new Date(), batch = 300): Promise<{ closed: number; days: string[] }> {
    const days = new Set<string>();
    let closed = 0;
    for (let round = 0; round < 20; round++) {
        const rows = await SignupAttemptModel.find(
            { outcome: 'in_progress', startedAt: { $lt: new Date(now.getTime() - VERIFY_WINDOW_MS) } },
            { userId: 1, startedAt: 1, wrongCodes: 1, day: 1 },
        ).sort({ startedAt: 1 }).limit(batch).lean();
        if (!rows.length) break;
        const ids = rows.filter(r => r.userId).map(r => String(r.userId));
        const since = new Date(Math.min(...rows.map(r => new Date(r.startedAt).getTime())) - 60_000);
        const deliveries = ids.length ? await notificationService.getOtpDelivery(ids, since) : {};
        const ops: any[] = [];
        for (const r of rows) {
            const list = deliveries ? (deliveries[String(r.userId)] || []) : null;
            let reason: string;
            let detail: string | null = null;
            if (!list) {
                if (now.getTime() - new Date(r.startedAt).getTime() < 2 * VERIFY_WINDOW_MS) continue;
                reason = 'never_verified';
                detail = 'delivery_unknown';
            } else {
                const own = list.filter(d => new Date(d.at).getTime() >= new Date(r.startedAt).getTime() - 60_000);
                const sent = own.some(d => d.status === 'sent' || d.status === 'delivered');
                if (!sent) {
                    reason = 'code_not_received';
                    detail = own.length ? own.map(d => `${d.channel}:${d.status}${d.error ? ` ${d.error}` : ''}`).join('; ').slice(0, 200) : 'no_send_recorded';
                } else reason = (r.wrongCodes || 0) > 0 ? 'wrong_code' : 'never_verified';
            }
            ops.push({
                updateOne: {
                    filter: { _id: r._id, outcome: 'in_progress' },
                    update: { $set: { outcome: 'failed', step: 'code', reason, detail, failedAt: now, delivery: (list || []).slice(0, 10) } },
                },
            });
            days.add(r.day);
        }
        if (!ops.length) break;
        const res = await SignupAttemptModel.bulkWrite(ops, { ordered: false });
        closed += res.modifiedCount;
        if (rows.length < batch) break;
    }
    return { closed, days: [...days] };
}

// ---- read-only list --------------------------------------------------------

export interface SignupListQuery {
    from: string; to: string; country?: string | null; countries?: string[] | null; source?: SignupSource | null;
    outcome?: SignupOutcome | null; reason?: string | null; group?: FailureGroup | null; cursor?: string | null; limit?: number;
}

export async function listSignupAttempts(q: SignupListQuery) {
    const filter: Record<string, unknown> = { day: { $gte: q.from, $lte: q.to } };
    if (q.country) filter.country = q.country;
    else if (q.countries?.length) filter.country = { $in: q.countries };
    if (q.source) filter.source = q.source;
    if (q.outcome) filter.outcome = q.outcome;
    if (q.reason) filter.reason = q.reason;
    else if (q.group) {
        const reasons = Object.entries(SIGNUP_REASONS).filter(([, v]) => v.group === q.group).map(([k]) => k);
        filter.reason = q.group === 'unknown' ? { $nin: Object.keys(SIGNUP_REASONS) } : { $in: reasons };
        filter.outcome = 'failed';
    }
    if (q.cursor && Types.ObjectId.isValid(q.cursor)) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const rows = await SignupAttemptModel.find(filter, { expiresAt: 0 }).sort({ _id: -1 }).limit(limit + 1).lean();
    const items = rows.slice(0, limit).map(r => ({
        id: String(r._id),
        startedAt: r.startedAt, day: r.day, country: r.country, geoCountry: r.geoCountry ?? null, source: r.source,
        outcome: r.outcome, step: r.step, reason: r.reason ?? null, group: r.outcome === 'failed' ? reasonGroup(r.reason) : null,
        reasonLabel: r.reason ? SIGNUP_REASONS[r.reason]?.label ?? r.reason : null,
        detail: r.detail ?? null, email: r.emailMasked ?? null, phone: r.phoneMasked ?? null, sponsorCode: r.sponsorCode ?? null,
        annonceur: !!r.annonceur, userId: r.userId ? String(r.userId) : null, wrongCodes: r.wrongCodes || 0,
        delivery: r.delivery || [], requestId: r.requestId ?? null, replayUrl: r.replayUrl ?? null,
        completedAt: r.completedAt ?? null, failedAt: r.failedAt ?? null,
    }));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}
