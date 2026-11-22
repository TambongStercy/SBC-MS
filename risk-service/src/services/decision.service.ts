import { Schema, model } from 'mongoose';
import { config } from '../config';
import { Decision, IdentifierModel, RiskEventModel, RiskMemberModel } from '../database/models';
import { childLogger } from '../lib/logger';
import { readyRedis, redis, rkey } from '../lib/redis';

const log = childLogger('Decision');

/**
 * The payout pre-check's question: "may this member withdraw now?" (plan §4).
 * Answered from the member's last score (look-back / scoring run): Redis first
 * (10 min), MongoDB otherwise. A member never scored is `allow`.
 *
 * Every question is logged in `decisionlogs` (90 days) with what was answered,
 * so the silent weeks show what enforcement WOULD have refused before anyone
 * turns it on.
 */
export interface DecisionAnswer {
    decision: Decision; score: number; groupSize: number;
    reasons: { rule: string; points: number; detail: string }[];
    scoredAt: string | null;
}

const ALLOW: DecisionAnswer = { decision: 'allow', score: 0, groupSize: 1, reasons: [], scoredAt: null };
const CACHE_TTL_S = 600;

const DecisionLogSchema = new Schema({
    userId: { type: String, required: true },
    action: { type: String, required: true },
    amount: { type: Number, default: null },
    currency: { type: String, default: null },
    transactionId: { type: String, default: null },
    decision: { type: String, required: true },
    score: { type: Number, default: 0 },
    rules: { type: [String], default: [] },
    caller: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
}, { collection: 'decisionlogs', versionKey: false });
DecisionLogSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 86400 });
DecisionLogSchema.index({ userId: 1, at: -1 });
DecisionLogSchema.index({ decision: 1, at: -1 });
export const DecisionLogModel = model('DecisionLog', DecisionLogSchema);

async function fromCache(userId: string): Promise<DecisionAnswer | null> {
    const r = redis();
    if (!r || r.status !== 'ready') return null;
    try {
        const raw = await r.get(rkey(`decision:${userId}`));
        return raw ? JSON.parse(raw) as DecisionAnswer : null;
    } catch { return null; }
}

async function toCache(userId: string, a: DecisionAnswer): Promise<void> {
    const r = redis();
    if (!r || r.status !== 'ready') return;
    try { await r.set(rkey(`decision:${userId}`), JSON.stringify(a), 'EX', CACHE_TTL_S); } catch { /* cache only */ }
}

/** Drops every cached decision (after a scoring run). */
export async function clearDecisionCache(): Promise<number> {
    const r = await readyRedis();
    if (redis() && !r) log.warn('Redis not ready: cached decisions expire within 10 min');
    if (!r) return 0;
    let n = 0;
    try {
        let cursor = '0';
        do {
            const [next, keys] = await r.scan(cursor, 'MATCH', rkey('decision:*'), 'COUNT', 1000);
            cursor = next;
            if (keys.length) n += await r.del(...keys);
        } while (cursor !== '0');
    } catch (e: any) { log.warn({ message: e?.message }, 'decision cache not cleared'); }
    return n;
}

export async function decisionFor(userId: string): Promise<DecisionAnswer> {
    const cached = await fromCache(userId);
    if (cached) return cached;
    const m = await RiskMemberModel.findOne({ userId }).lean() as any;
    const now = Date.now();
    const live = (m?.liveReasons ?? []).filter((r: any) => new Date(r.expiresAt).getTime() > now);
    const a: DecisionAnswer = m
        ? { decision: m.decision, score: m.score, groupSize: m.groupSize, reasons: [...(m.reasons ?? []), ...live].map((r: any) => ({ rule: r.rule, points: r.points, detail: r.detail })), scoredAt: m.scoredAt ? new Date(m.scoredAt).toISOString() : null }
        : ALLOW;
    await toCache(userId, a);
    return a;
}

export async function decide(input: { userId: string; action: string; amount?: number; currency?: string; transactionId?: string; caller?: string }): Promise<DecisionAnswer> {
    const a = await decisionFor(input.userId);
    DecisionLogModel.create({
        userId: input.userId, action: input.action, amount: input.amount ?? null, currency: input.currency ?? null,
        transactionId: input.transactionId ?? null, decision: a.decision, score: a.score, rules: a.reasons.map(r => r.rule), caller: input.caller ?? null,
    }).catch((e: any) => log.warn({ message: e?.message }, 'decision not logged'));
    return a;
}

/** For the support desk's member card: score, reasons, linked accounts, shared identifiers (tails only). */
export async function memberView(userId: string) {
    const m = await RiskMemberModel.findOne({ userId }).lean() as any;
    const linked = m && m.groupSize > 1
        ? (await RiskMemberModel.find({ groupId: m.groupId, userId: { $ne: userId } }).sort({ score: -1 }).limit(50).lean() as any[])
            .map(x => ({ userId: x.userId, score: x.score, decision: x.decision, country: x.country }))
        : [];
    // shared identifiers only (the index also holds the member's own, unshared ones)
    const identifiers = (await IdentifierModel.find({ accounts: userId, count: { $gte: 2 } }).limit(50).lean() as any[])
        .map(i => ({ kind: i.kind, uses: i.uses ?? [], tail: i.tail, count: i.count, hub: i.hub }));
    const now = Date.now();
    const liveReasons = (m?.liveReasons ?? []).filter((r: any) => new Date(r.expiresAt).getTime() > now)
        .map((r: any) => ({ rule: r.rule, points: r.points, detail: r.detail, at: r.at, expiresAt: r.expiresAt }));
    // what happened lately (types and dates only)
    const events = (await RiskEventModel.find({ userId }, { _id: 0, type: 1, at: 1, 'data.kind': 1, 'data.amountXaf': 1, 'data.payoutTail': 1 }).sort({ at: -1 }).limit(20).lean() as any[])
        .map(e => ({ type: e.type, at: e.at, kind: e.data?.kind ?? null, amountXaf: e.data?.amountXaf ?? null, numberTail: e.data?.payoutTail ?? null }));
    return {
        userId, scored: !!m,
        score: m?.score ?? 0, decision: (m?.decision ?? 'allow') as Decision, reasons: m?.reasons ?? [],
        structuralScore: m?.structuralScore ?? m?.score ?? 0, liveReasons, events,
        groupId: m?.groupId ?? null, groupSize: m?.groupSize ?? 1, linked, identifiers,
        scoredAt: m?.scoredAt ?? null,
    };
}
