import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { AnimCandidate, AnimChallenge } from '../models/challenge.model';
import { AnimFraudFlag, IAnimFraudFlag } from '../models/governance.model';
import { AnimVote, AnimVoteTransaction, IAnimVoteTransaction } from '../models/vote.model';
import { ChallengeStatus, FraudFlagStatus, FraudReview, TeamRole, VoteKind, VoteStatus, VoteTxStatus } from '../types';
import { audit } from '../lib/audit';
import { markBoardDirty } from './board.service';

const log = logger.getLogger('AnimationFraud');

/**
 * Anti-fraud (§20). Signals put a subject "À vérifier" for SBC administration;
 * they never silently cancel anything. Thresholds are deliberately simple and
 * live here, in one place, so product can tune them.
 */
export const THRESHOLDS = {
    purchasesPerHour: 10,           // one account, one challenge
    failedPaymentsPerHour: 5,
    voteShareOfTotal: 0.3,          // one purchase ≥ 30 % of the challenge's votes…
    voteShareMinTotal: 100,         // …once the challenge has some volume
    votersPerIpPerHour: 15,         // distinct accounts voting from one network address
    votersPerUaPerHour: 40,         // distinct accounts on one device signature
    freeVotesPerIpPerHour: 60,
    candidateBurstShare: 0.6,       // one candidate takes ≥ 60 % of the last 15 min…
    candidateBurstMin: 80,          // …of at least this many free votes
    freezeBlockScore: 50,           // open flags at or above this block freezing the result
};

const raise = async (args: {
    organizerId: Types.ObjectId; eventId: Types.ObjectId; challengeId: Types.ObjectId;
    subjectType: IAnimFraudFlag['subjectType']; subjectId: string;
    signal: { code: string; value: number; threshold: number; note?: string }; weight: number;
}) => {
    try {
        const flag = await AnimFraudFlag.findOneAndUpdate(
            { challengeId: args.challengeId, subjectType: args.subjectType, subjectId: args.subjectId, status: FraudFlagStatus.OPEN },
            {
                $setOnInsert: { organizerId: args.organizerId, eventId: args.eventId },
                $push: { signals: { $each: [args.signal], $slice: -20 } },
                $inc: { score: args.weight },
            },
            { upsert: true, new: true },
        );
        if (args.subjectType === 'USER') {
            await AnimVoteTransaction.updateMany(
                { challengeId: args.challengeId, userId: args.subjectId, 'fraud.review': FraudReview.NONE },
                { $set: { 'fraud.review': FraudReview.PENDING }, $addToSet: { 'fraud.flags': args.signal.code } },
            );
        }
        if (args.subjectType === 'TRANSACTION') {
            await AnimVoteTransaction.updateOne(
                { _id: args.subjectId },
                { $set: { 'fraud.review': FraudReview.PENDING }, $addToSet: { 'fraud.flags': args.signal.code }, $inc: { 'fraud.score': args.weight } },
            );
        }
        return flag;
    } catch (err: any) {
        if (err?.code === 11000) return null; // a concurrent raise created it; next signal will land
        throw err;
    }
};

/** payment-service confirmed a different amount than the pack price: never credited, reviewed by SBC. */
export const flagAmountMismatch = async (tx: IAnimVoteTransaction, paid: number) =>
    raise({
        organizerId: tx.organizerId, eventId: tx.eventId, challengeId: tx.challengeId, subjectType: 'TRANSACTION', subjectId: String(tx._id),
        signal: { code: 'AMOUNT_MISMATCH', value: paid, threshold: tx.amount }, weight: 100,
    });

/** At purchase start: velocity and failed-payment bursts for this account. */
export const evaluatePurchase = async (tx: IAnimVoteTransaction) => {
    const since = new Date(Date.now() - 3_600_000);
    const [recent, failed] = await Promise.all([
        AnimVoteTransaction.countDocuments({ userId: tx.userId, challengeId: tx.challengeId, createdAt: { $gt: since } }),
        AnimVoteTransaction.countDocuments({ userId: tx.userId, challengeId: tx.challengeId, status: { $in: [VoteTxStatus.FAILED, VoteTxStatus.CANCELLED] }, createdAt: { $gt: since } }),
    ]);
    const base = { organizerId: tx.organizerId, eventId: tx.eventId, challengeId: tx.challengeId, subjectType: 'USER' as const, subjectId: String(tx.userId) };
    if (recent > THRESHOLDS.purchasesPerHour) {
        await raise({ ...base, signal: { code: 'PURCHASE_VELOCITY', value: recent, threshold: THRESHOLDS.purchasesPerHour }, weight: 20 });
    }
    if (failed >= THRESHOLDS.failedPaymentsPerHour) {
        await raise({ ...base, signal: { code: 'FAILED_PAYMENT_BURST', value: failed, threshold: THRESHOLDS.failedPaymentsPerHour }, weight: 15 });
    }
};

/** After settlement: one purchase that dominates the whole challenge. */
export const evaluateSettled = async (txId: Types.ObjectId | string) => {
    const tx = await AnimVoteTransaction.findById(txId).lean();
    if (!tx) return;
    const challenge = await AnimChallenge.findById(tx.challengeId).select('counters').lean();
    const total = (challenge?.counters.freeVotes ?? 0) + (challenge?.counters.paidVotes ?? 0);
    if (total >= THRESHOLDS.voteShareMinTotal && tx.votes / total >= THRESHOLDS.voteShareOfTotal) {
        await raise({
            organizerId: tx.organizerId, eventId: tx.eventId, challengeId: tx.challengeId, subjectType: 'TRANSACTION', subjectId: String(tx._id),
            signal: { code: 'VOLUME_SHARE', value: Math.round((100 * tx.votes) / total), threshold: THRESHOLDS.voteShareOfTotal * 100 }, weight: 25,
        });
    }
};

/**
 * Periodic scan (job, every 5 min) over challenges in voting: shared network
 * addresses and device signatures across many accounts (multi-accounting,
 * bots), and one candidate taking a sudden majority of free votes.
 */
export const scanChallenges = async (): Promise<number> => {
    const open = await AnimChallenge.find({ status: ChallengeStatus.VOTING_OPEN }).select('_id organizerId eventId').lean();
    let raised = 0;
    for (const c of open) {
        const since = new Date(Date.now() - 3_600_000);
        const base = { organizerId: c.organizerId, eventId: c.eventId, challengeId: c._id };
        const byIp = await AnimVote.aggregate<{ _id: string; voters: string[]; n: number }>([
            { $match: { challengeId: c._id, kind: VoteKind.FREE, status: VoteStatus.COUNTED, at: { $gt: since }, ipHash: { $exists: true } } },
            { $group: { _id: '$ipHash', voters: { $addToSet: '$voterUserId' }, n: { $sum: 1 } } },
            { $match: { $or: [{ [`voters.${THRESHOLDS.votersPerIpPerHour - 1}`]: { $exists: true } }, { n: { $gte: THRESHOLDS.freeVotesPerIpPerHour } }] } },
        ]);
        for (const r of byIp) {
            if (r.voters.length >= THRESHOLDS.votersPerIpPerHour || r.n >= THRESHOLDS.freeVotesPerIpPerHour) {
                await raise({ ...base, subjectType: 'IP', subjectId: r._id, signal: { code: 'SHARED_IP', value: r.voters.length, threshold: THRESHOLDS.votersPerIpPerHour, note: `${r.n} votes` }, weight: 30 });
                raised++;
            }
        }
        const byUa = await AnimVote.aggregate<{ _id: string; voters: string[] }>([
            { $match: { challengeId: c._id, kind: VoteKind.FREE, status: VoteStatus.COUNTED, at: { $gt: since }, uaHash: { $exists: true } } },
            { $group: { _id: '$uaHash', voters: { $addToSet: '$voterUserId' } } },
            { $match: { [`voters.${THRESHOLDS.votersPerUaPerHour - 1}`]: { $exists: true } } },
        ]);
        for (const r of byUa) {
            await raise({ ...base, subjectType: 'IP', subjectId: `ua:${r._id}`, signal: { code: 'SHARED_DEVICE', value: r.voters.length, threshold: THRESHOLDS.votersPerUaPerHour }, weight: 20 });
            raised++;
        }
        const recent = new Date(Date.now() - 15 * 60_000);
        const burst = await AnimVote.aggregate<{ _id: Types.ObjectId; n: number }>([
            { $match: { challengeId: c._id, kind: VoteKind.FREE, status: VoteStatus.COUNTED, at: { $gt: recent } } },
            { $group: { _id: '$candidateId', n: { $sum: '$quantity' } } },
        ]);
        const total = burst.reduce((s, b) => s + b.n, 0);
        for (const b of burst) {
            if (total >= THRESHOLDS.candidateBurstMin && b.n / total >= THRESHOLDS.candidateBurstShare) {
                await raise({ ...base, subjectType: 'CANDIDATE', subjectId: String(b._id), signal: { code: 'CANDIDATE_BURST', value: Math.round((100 * b.n) / total), threshold: THRESHOLDS.candidateBurstShare * 100, note: `${b.n}/${total} votes en 15 min` }, weight: 15 });
                raised++;
            }
        }
    }
    return raised;
};

export const blockingFlags = (challengeId: Types.ObjectId | string) =>
    AnimFraudFlag.countDocuments({ challengeId, status: FraudFlagStatus.OPEN, score: { $gte: THRESHOLDS.freezeBlockScore } });

const voidFreeVotes = async (challengeId: Types.ObjectId, match: Record<string, unknown>, reason: string, by: string) => {
    const votes = await AnimVote.find({ challengeId, kind: VoteKind.FREE, status: VoteStatus.COUNTED, ...match }).select('_id candidateId quantity').lean();
    const perCandidate = new Map<string, number>();
    for (const v of votes) {
        const res = await AnimVote.updateOne({ _id: v._id, status: VoteStatus.COUNTED }, { $set: { status: VoteStatus.VOID, voidReason: reason, voidedBy: by } });
        if (res.modifiedCount) perCandidate.set(String(v.candidateId), (perCandidate.get(String(v.candidateId)) ?? 0) + v.quantity);
    }
    let total = 0;
    for (const [cid, n] of perCandidate) {
        total += n;
        await AnimCandidate.updateOne({ _id: cid }, { $inc: { freeVotes: -n, totalVotes: -n } });
    }
    if (total) {
        await AnimChallenge.updateOne({ _id: challengeId }, { $inc: { 'counters.freeVotes': -total } });
        await markBoardDirty(challengeId);
    }
    return total;
};

/**
 * SBC admin decision on a flag. Confirming can void the subject's free votes,
 * refund its paid purchases and/or disqualify a candidate — each logged.
 */
export const reviewFlag = async (adminUserId: string, flagId: string, decision: 'clear' | 'confirm', opts: { note?: string; voidVotes?: boolean; refund?: boolean; disqualify?: boolean } = {}) => {
    const flag = await AnimFraudFlag.findOneAndUpdate(
        { _id: flagId, status: FraudFlagStatus.OPEN },
        { $set: { status: decision === 'clear' ? FraudFlagStatus.CLEARED : FraudFlagStatus.CONFIRMED, reviewedBy: adminUserId, reviewNote: opts.note, reviewedAt: new Date() } },
        { new: true },
    );
    if (!flag) throw new AppError('Signalement introuvable ou déjà traité.', 404);
    const actor = { actorUserId: adminUserId, role: TeamRole.SBC_ADMIN };
    const result: Record<string, number> = {};
    const txFilter: Record<string, unknown> = { challengeId: flag.challengeId };
    if (flag.subjectType === 'USER') txFilter.userId = new Types.ObjectId(flag.subjectId);
    else if (flag.subjectType === 'TRANSACTION') txFilter._id = new Types.ObjectId(flag.subjectId);
    else if (flag.subjectType === 'CANDIDATE') txFilter.candidateId = new Types.ObjectId(flag.subjectId);
    else txFilter.ipHash = flag.subjectId.replace(/^ua:/, '');

    await AnimVoteTransaction.updateMany(
        { ...txFilter, 'fraud.review': FraudReview.PENDING },
        { $set: { 'fraud.review': decision === 'clear' ? FraudReview.CLEARED : FraudReview.CONFIRMED } },
    );

    if (decision === 'confirm') {
        const reason = `Fraude confirmée : ${opts.note ?? flag.signals.map((s) => s.code).join(', ')}`;
        if (opts.voidVotes) {
            const match: Record<string, unknown> =
                flag.subjectType === 'USER' ? { voterUserId: new Types.ObjectId(flag.subjectId) }
                : flag.subjectType === 'CANDIDATE' ? { candidateId: new Types.ObjectId(flag.subjectId) }
                : flag.subjectId.startsWith('ua:') ? { uaHash: flag.subjectId.slice(3) }
                : flag.subjectType === 'IP' ? { ipHash: flag.subjectId } : { _id: null };
            result.voidedFreeVotes = await voidFreeVotes(flag.challengeId, match, reason, adminUserId);
        }
        if (opts.refund) {
            const { refundTransaction } = await import('./paid-vote.service');
            const txs = await AnimVoteTransaction.find({ ...txFilter, status: VoteTxStatus.SUCCESS }).select('_id').lean();
            for (const t of txs) await refundTransaction(actor, t._id, reason);
            result.refunded = txs.length;
        }
        if (opts.disqualify && flag.subjectType === 'CANDIDATE') {
            const cand = await AnimCandidate.findById(flag.subjectId);
            if (cand && cand.status !== 'DISQUALIFIED') {
                await AnimCandidate.updateOne({ _id: cand._id }, {
                    $set: { status: 'DISQUALIFIED' },
                    $push: { statusHistory: { from: cand.status, to: 'DISQUALIFIED', at: new Date(), by: new Types.ObjectId(adminUserId), reason } },
                });
                if (cand.status === 'APPROVED') await AnimChallenge.updateOne({ _id: cand.challengeId }, { $inc: { 'counters.approved': -1, 'counters.candidates': -1 } });
                else if (cand.status === 'PENDING') await AnimChallenge.updateOne({ _id: cand.challengeId }, { $inc: { 'counters.candidates': -1 } });
                await markBoardDirty(cand.challengeId);
                result.disqualified = 1;
            }
        }
    }
    await audit({
        actor, action: decision === 'clear' ? 'fraud.clear' : 'fraud.confirm', targetType: 'fraud_flag', targetId: flag._id,
        organizerId: flag.organizerId, eventId: flag.eventId, challengeId: flag.challengeId,
        after: { subject: `${flag.subjectType}:${flag.subjectId}`, ...result }, reason: opts.note,
    });
    log.info(`Fraud flag ${flag._id} ${decision} by ${adminUserId}: ${JSON.stringify(result)}`);
    return { flag, result };
};
