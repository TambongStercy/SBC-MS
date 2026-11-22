import crypto from 'crypto';
import { Types } from 'mongoose';
import type { Request } from 'express';
import config from '../config';
import { SigninAttemptModel, SigninOutcome, ISigninAttempt } from '../database/models/signin-attempt.model';
import { userRepository } from '../database/repositories/user.repository';
import { doualaDay } from './activity-signals.service';
import { maskEmail, maskPhone } from '../utils/mask-email';
import { incrWindow } from '../utils/redis';
import { riskEvent } from '../utils/risk-event';
import logger from '../utils/logger';

const log = logger.getLogger('SigninAttempts');

/**
 * Security plan Phase 1 item 3: every sign-in step is recorded, success or not.
 *   password step  POST /users/login       → code_sent | unknown_account | wrong_password | blocked | invalid | error
 *   code step      POST /users/verify-otp  → signed_in | wrong_code   (only after a password step of
 *                                             this process: the same route also confirms sign-ups,
 *                                             which signup_attempts records)
 * Written after the answer, buffered (1 s / 200), never awaited by the request.
 * A member's 10th wrong password within an hour goes to the fraud engine
 * (Phase 4: someone may be guessing it).
 */
const RETENTION_DAYS = 180;
const FLUSH_MS = 1000;
const FLUSH_SIZE = 200;
const HARD_CAP = 5000;
export const GUESSING_THRESHOLD = 10;
const CODE_WINDOW_MS = 30 * 60_000;

const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v || '').toString().trim();
};

export const identifierKeyOf = (raw: string) =>
    crypto.createHmac('sha256', config.services.serviceSecret || 'sbc').update(`signin:${raw.trim().toLowerCase()}`).digest('hex').slice(0, 32);

export function signinContext(req: Request, now: Date = new Date()) {
    const geo = header(req, 'x-sbc-geo').toUpperCase();
    const client = header(req, 'x-sbc-client');
    const requestId = header(req, 'x-request-id');
    return {
        day: doualaDay(now), at: now,
        country: /^[A-Z]{2}$/.test(geo) && geo !== 'T1' ? geo : 'XX',
        source: (client === 'web' || client === 'app' ? client : 'api') as 'web' | 'app' | 'api',
        requestId: /^[A-Za-z0-9._:-]{1,80}$/.test(requestId) ? requestId : null,
    };
}
export type SigninContext = ReturnType<typeof signinContext>;

const pending: Partial<ISigninAttempt>[] = [];
let timer: NodeJS.Timeout | null = null;
export const signinStats = { recorded: 0, flushed: 0, dropped: 0, flushErrors: 0 };
/** Members who passed the password step lately (so their next code is a sign-in, not a sign-up). */
const awaitingCode = new Map<string, number>();
/** Fallback count of wrong passwords when Redis is off: userId → timestamps. */
const localFailures = new Map<string, number[]>();

async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending.length) return;
    const docs = pending.splice(0, pending.length);
    try {
        await SigninAttemptModel.insertMany(docs, { ordered: false });
        signinStats.flushed += docs.length;
    } catch (err: any) {
        signinStats.flushErrors++;
        log.warn(`Sign-in attempts flush: ${err?.message ?? err}`);
    }
}
export const flushSigninAttempts = flush;

function push(doc: Partial<ISigninAttempt>) {
    if (pending.length >= HARD_CAP) { signinStats.dropped++; return; }
    pending.push(doc);
    signinStats.recorded++;
    if (pending.length >= FLUSH_SIZE) void flush();
    else if (!timer) { timer = setTimeout(() => { void flush(); }, FLUSH_MS); timer.unref?.(); }
}

const mask = (raw: string) => (raw.includes('@') ? maskEmail(raw) : maskPhone(raw));

/** Counts a wrong password for the account; the 10th within an hour is sent to the fraud engine once. */
async function noteWrongPassword(userId: string, now: number): Promise<number> {
    let n = await incrWindow(`signinfail:${userId}`, 3600);
    if (n === null) {
        const list = (localFailures.get(userId) || []).filter(t => now - t < 3_600_000);
        list.push(now);
        localFailures.set(userId, list);
        if (localFailures.size > 50_000) localFailures.clear();
        n = list.length;
    }
    if (n === GUESSING_THRESHOLD) {
        riskEvent('signin_failures', userId, { count: n });
        log.warn(`Sign-in: ${n} wrong passwords within an hour for user ${userId}.`);
    }
    return n;
}

/** The password step's outcome. Never throws, never blocks the answer. */
export function recordPasswordStep(ctx: SigninContext, identifier: string | null | undefined, outcome: SigninOutcome, userId?: string | null): void {
    void (async () => {
        try {
            const raw = typeof identifier === 'string' ? identifier.trim().slice(0, 200) : '';
            let uid = userId && Types.ObjectId.isValid(userId) ? userId : null;
            // A wrong password names no user in the error: find the account to count it.
            if (!uid && raw && (outcome === 'wrong_password' || outcome === 'blocked')) {
                const u = await userRepository.findByIdentifier(raw).catch(() => null);
                if (u) uid = String(u._id);
            }
            if (outcome === 'code_sent' && uid) {
                awaitingCode.set(uid, ctx.at.getTime());
                if (awaitingCode.size > 100_000) awaitingCode.clear();
            }
            push({
                _id: new Types.ObjectId(), ...ctx, step: 'password', outcome,
                userId: uid ? new Types.ObjectId(uid) : null,
                identifierMasked: raw ? mask(raw) : null,
                identifierKey: raw ? identifierKeyOf(raw) : null,
                expiresAt: new Date(ctx.at.getTime() + RETENTION_DAYS * 86400_000),
            });
            if (outcome === 'wrong_password' && uid) await noteWrongPassword(uid, ctx.at.getTime());
        } catch (err: any) {
            log.warn(`Sign-in attempt not recorded: ${err?.message ?? err}`);
        }
    })();
}

/** The code step: recorded only for a member who passed the password step in the last 30 min. */
export function recordCodeStep(ctx: SigninContext, userId: string, ok: boolean): void {
    try {
        const since = awaitingCode.get(userId);
        if (!since || ctx.at.getTime() - since > CODE_WINDOW_MS) return;
        if (ok) awaitingCode.delete(userId);
        push({
            _id: new Types.ObjectId(), ...ctx, step: 'code', outcome: ok ? 'signed_in' : 'wrong_code',
            userId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
            expiresAt: new Date(ctx.at.getTime() + RETENTION_DAYS * 86400_000),
        });
    } catch (err: any) {
        log.warn(`Sign-in code step not recorded: ${err?.message ?? err}`);
    }
}

/** For tests: forget the in-memory state. */
export function _resetSigninState() { awaitingCode.clear(); localFailures.clear(); pending.length = 0; }
