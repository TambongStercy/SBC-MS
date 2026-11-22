import { config } from '../config';
import { Reason, RiskCaseSentModel, RiskMemberModel } from '../database/models';
import { childLogger } from '../lib/logger';
import { readyRedis, rkey } from '../lib/redis';
import { CaseOut, MemberOut } from './analysis';
import { CaseInput, openCase } from './support.client';

const log = childLogger('Scoring');

/**
 * A member's score = structural points (links and referral rules: look-back,
 * weekly rebuild, live group rescoring) + live points (event rules, each until
 * its expiry). Both are kept on `riskmembers`; the score and the decision are
 * recomputed in the database from both, so a rebuild never wipes a live reason
 * and a live event never wipes the rebuild's.
 */

/** Pipeline stages: drop expired live reasons, then score = structural + live, then the decision. */
export function scoreStages(now: Date) {
    const t = config.thresholds;
    return [
        { $set: { liveReasons: { $filter: { input: { $ifNull: ['$liveReasons', []] }, as: 'r', cond: { $gt: ['$$r.expiresAt', now] } } } } },
        { $set: { score: { $add: [{ $ifNull: ['$structuralScore', 0] }, { $sum: '$liveReasons.points' }] } } },
        {
            $set: {
                decision: {
                    $switch: {
                        branches: [{ case: { $gte: ['$score', t.hold] }, then: 'hold' }, { case: { $gte: ['$score', t.requireCode] }, then: 'require_code' }],
                        default: 'allow',
                    },
                },
            },
        },
    ];
}

/** The update that stores a member's structural result (from `analyse`) and rescores them. */
export function structuralUpdate(m: MemberOut, runId: string, now: Date) {
    return [
        {
            $set: {
                userId: m.userId, groupId: m.groupId, groupSize: m.groupSize, country: m.country,
                reasons: { $literal: m.reasons }, structuralScore: m.score, scoredAt: now, runId,
            },
        },
        ...scoreStages(now),
    ];
}

/** Back to no structural reason (the member is no longer linked or flagged); live reasons stay. */
export function clearedUpdate(runId: string, now: Date) {
    return [
        { $set: { reasons: [], structuralScore: 0, groupId: '$userId', groupSize: 1, scoredAt: now, runId } },
        ...scoreStages(now),
    ];
}

export async function storeMembers(members: MemberOut[], runId: string, now: Date = new Date()): Promise<void> {
    for (let i = 0; i < members.length; i += 1000) {
        await RiskMemberModel.bulkWrite(members.slice(i, i + 1000).map(m => ({
            updateOne: { filter: { userId: m.userId }, update: structuralUpdate(m, runId, now) as any, upsert: true },
        })), { ordered: false });
    }
}

/** Adds (or replaces, same rule) a live reason, then rescores the member. */
export async function addLiveReason(userId: string, r: Reason, ttlDays: number, now: Date = new Date()): Promise<void> {
    const reason = { rule: r.rule, points: r.points, detail: r.detail, caseType: r.caseType ?? null, at: now, expiresAt: new Date(now.getTime() + ttlDays * 86_400_000) };
    await RiskMemberModel.updateOne(
        { userId },
        [
            {
                $set: {
                    userId,
                    groupId: { $ifNull: ['$groupId', userId] }, groupSize: { $ifNull: ['$groupSize', 1] },
                    reasons: { $ifNull: ['$reasons', []] }, structuralScore: { $ifNull: ['$structuralScore', 0] },
                    liveReasons: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ['$liveReasons', []] }, as: 'x', cond: { $ne: ['$$x.rule', r.rule] } } },
                            [{ $literal: reason }],
                        ],
                    },
                    scoredAt: now,
                },
            },
            ...scoreStages(now),
        ] as any,
        { upsert: true },
    );
    await dropCached([userId]);
}

/** Live reasons past their expiry are dropped and the members rescored (hourly). */
export async function expireLiveReasons(now: Date = new Date()): Promise<number> {
    const ids = (await RiskMemberModel.find({ 'liveReasons.expiresAt': { $lte: now } }, { userId: 1 }).limit(10_000).lean() as any[]).map(x => x.userId);
    if (!ids.length) return 0;
    await RiskMemberModel.updateMany({ userId: { $in: ids } }, scoreStages(now) as any);
    await dropCached(ids);
    return ids.length;
}

/** The payout pre-check reads Redis first: drop what changed so the next question reads Mongo. */
export async function dropCached(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    const r = await readyRedis(500);
    if (!r) return;
    try {
        for (let i = 0; i < userIds.length; i += 500) await r.del(...userIds.slice(i, i + 500).map(id => rkey(`decision:${id}`)));
    } catch (e: any) { log.warn({ message: e?.message }, 'cached decisions not dropped (expire within 10 min)'); }
}

const RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Sends cases to support, but only when new to risk-service or worse than last
 * sent (severity up, more accounts): support counts every send as an occurrence,
 * and live rescoring sees the same group on every event.
 */
export async function sendCases(cases: (CaseOut | CaseInput)[], alert: boolean, extra: Record<string, unknown> = {}): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const c of cases) {
        const accountCount = Number((c.details as any)?.accountCount ?? 1) || 1;
        const prev = await RiskCaseSentModel.findById(c.dedupKey).lean() as any;
        if (prev && (RANK[prev.severity] ?? 0) >= (RANK[c.severity] ?? 0) && (prev.accountCount ?? 0) >= accountCount) {
            out.unchanged = (out.unchanged ?? 0) + 1;
            continue;
        }
        const r = await openCase({ ...(c as CaseInput), alert, details: { ...(c.details ?? {}), ...extra } });
        out[r] = (out[r] ?? 0) + 1;
        if (r !== 'refused') await RiskCaseSentModel.updateOne({ _id: c.dedupKey }, { $set: { severity: c.severity, accountCount, sentAt: new Date() } }, { upsert: true });
    }
    return out;
}
