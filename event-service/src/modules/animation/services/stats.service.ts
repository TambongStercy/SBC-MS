import { Types } from 'mongoose';
import Event from '../../../database/models/event.model';
import Organizer from '../../../database/models/organizer.model';
import { AnimCandidate, AnimChallenge } from '../models/challenge.model';
import { AnimAuditLog, AnimFraudFlag } from '../models/governance.model';
import { AnimBoardSnapshot, AnimRewardWinner } from '../models/reward.model';
import { AnimVoteTransaction } from '../models/vote.model';
import { AnimCtx, FraudFlagStatus, VoteTxStatus } from '../types';

/** Organizer dashboard for one event (§30). */
export const eventOverview = async (ctx: Pick<AnimCtx, 'eventId'>) => {
    const eventId = new Types.ObjectId(ctx.eventId);
    const [challenges, money, rewards, recent] = await Promise.all([
        AnimChallenge.find({ eventId }).select('name status counters suspendedAt').lean(),
        AnimVoteTransaction.aggregate<{ _id: string; n: number; amount: number; net: number; commission: number }>([
            { $match: { eventId, status: { $in: [VoteTxStatus.SUCCESS, VoteTxStatus.REFUNDED] }, lateSettlement: { $ne: true } } },
            { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' }, net: { $sum: '$organizerNet' }, commission: { $sum: '$commissionAmount' } } },
        ]),
        AnimRewardWinner.aggregate<{ _id: string; n: number }>([
            { $match: { eventId } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        AnimAuditLog.find({ eventId }).sort({ at: -1 }).limit(15).lean(),
    ]);
    const success = money.find((m) => m._id === VoteTxStatus.SUCCESS);
    const refunded = money.find((m) => m._id === VoteTxStatus.REFUNDED);
    const byStatus: Record<string, number> = {};
    for (const c of challenges) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const mostActive = challenges.slice().sort((a, b) => (b.counters.freeVotes + b.counters.paidVotes) - (a.counters.freeVotes + a.counters.paidVotes))[0];
    return {
        challenges: { total: challenges.length, byStatus },
        participants: challenges.reduce((s, c) => s + c.counters.candidates, 0),
        freeVotes: challenges.reduce((s, c) => s + c.counters.freeVotes, 0),
        paidVotes: challenges.reduce((s, c) => s + c.counters.paidVotes, 0),
        revenue: {
            gross: success?.amount ?? 0, organizerNet: success?.net ?? 0, commission: success?.commission ?? 0,
            transactions: success?.n ?? 0, refunded: refunded?.amount ?? 0, refundedCount: refunded?.n ?? 0,
        },
        rewards: Object.fromEntries(rewards.map((r) => [r._id, r.n])),
        mostActive: mostActive ? { _id: mostActive._id, name: mostActive.name, votes: mostActive.counters.freeVotes + mostActive.counters.paidVotes } : null,
        recentActivity: recent,
    };
};

/** Evolution of the board (§25): one point per snapshot, for the charts. */
export const boardHistory = async (challengeId: string, candidateId?: string) => {
    const snaps = await AnimBoardSnapshot.find({ challengeId }).sort({ takenAt: 1 }).limit(2000).lean();
    if (candidateId) {
        return snaps.map((s) => {
            const e = s.entries.find((x) => String(x.candidateId) === candidateId);
            return { at: s.takenAt, kind: s.kind, rank: e?.rank ?? null, votes: e ? e.free + e.paid : null, score: e?.score ?? null };
        });
    }
    return snaps.map((s) => ({
        at: s.takenAt, kind: s.kind,
        top: s.entries.slice(0, 10).map((e) => ({ candidateId: e.candidateId, number: e.number, rank: e.rank, votes: e.free + e.paid })),
    }));
};

/** SBC administration (§41). */
export const globalStats = async (opts: { from?: Date; to?: Date } = {}) => {
    const range = opts.from || opts.to ? { createdAt: { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lt: opts.to } : {}) } } : {};
    const [challenges, events, candidates, money, rewards, perEvent, perOrganizer, openFlags] = await Promise.all([
        AnimChallenge.aggregate<{ _id: string; n: number; free: number; paid: number }>([
            { $match: range },
            { $group: { _id: '$status', n: { $sum: 1 }, free: { $sum: '$counters.freeVotes' }, paid: { $sum: '$counters.paidVotes' } } },
        ]),
        AnimChallenge.distinct('eventId', range),
        AnimCandidate.countDocuments(range),
        AnimVoteTransaction.aggregate<{ _id: string; n: number; amount: number; commission: number; votes: number }>([
            { $match: { ...range, lateSettlement: { $ne: true } } },
            { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' }, commission: { $sum: '$commissionAmount' }, votes: { $sum: '$votes' } } },
        ]),
        AnimRewardWinner.aggregate<{ _id: string; n: number }>([{ $match: range }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        AnimChallenge.aggregate<{ _id: Types.ObjectId; challenges: number; votes: number; revenue: number }>([
            { $match: range },
            { $group: { _id: '$eventId', challenges: { $sum: 1 }, votes: { $sum: { $add: ['$counters.freeVotes', '$counters.paidVotes'] } }, revenue: { $sum: '$counters.paidRevenue' } } },
            { $sort: { votes: -1 } }, { $limit: 20 },
        ]),
        AnimChallenge.aggregate<{ _id: Types.ObjectId; challenges: number; votes: number; revenue: number }>([
            { $match: range },
            { $group: { _id: '$organizerId', challenges: { $sum: 1 }, votes: { $sum: { $add: ['$counters.freeVotes', '$counters.paidVotes'] } }, revenue: { $sum: '$counters.paidRevenue' } } },
            { $sort: { revenue: -1, votes: -1 } }, { $limit: 20 },
        ]),
        AnimFraudFlag.countDocuments({ status: FraudFlagStatus.OPEN }),
    ]);
    const evNames = await Event.find({ _id: { $in: perEvent.map((e) => e._id) } }).select('title slug').lean();
    const orgNames = await Organizer.find({ _id: { $in: perOrganizer.map((o) => o._id) } }).select('displayName').lean();
    const success = money.find((m) => m._id === VoteTxStatus.SUCCESS);
    return {
        eventsUsingModule: events.length,
        challenges: { total: challenges.reduce((s, c) => s + c.n, 0), byStatus: Object.fromEntries(challenges.map((c) => [c._id, c.n])) },
        candidates,
        votes: { free: challenges.reduce((s, c) => s + c.free, 0), paid: challenges.reduce((s, c) => s + c.paid, 0) },
        paid: {
            transactions: success?.n ?? 0, volume: success?.amount ?? 0, commission: success?.commission ?? 0,
            refunded: money.find((m) => m._id === VoteTxStatus.REFUNDED)?.amount ?? 0,
            pending: money.find((m) => m._id === VoteTxStatus.PENDING)?.n ?? 0,
        },
        rewards: Object.fromEntries(rewards.map((r) => [r._id, r.n])),
        openFraudFlags: openFlags,
        perEvent: perEvent.map((e) => ({ ...e, title: evNames.find((x) => String(x._id) === String(e._id))?.title })),
        perOrganizer: perOrganizer.map((o) => ({ ...o, name: orgNames.find((x) => String(x._id) === String(o._id))?.displayName })),
    };
};
