import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import { AnimCandidate, AnimChallenge, IAnimChallenge } from '../models/challenge.model';
import { AnimResult, IAnimResult, ResultEntry } from '../models/reward.model';
import { AnimJuryScore } from '../models/challenge.model';
import { AnimVote } from '../models/vote.model';
import { AnimCtx, CandidateStatus, ChallengeStatus, ResultStatus, TieRule, VoteKind, VoteStatus } from '../types';
import { Actor, audit } from '../lib/audit';
import { canonical, computeBoard, sha256 } from '../lib/rules';
import { markBoardDirty, takeSnapshot } from './board.service';
import { enqueue } from './outbox.service';

/**
 * Final calculation (§27): from the vote ledger and the submitted jury sheets —
 * never from the live counters, which are a cache. The inputs are hashed so the
 * frozen result can be re-derived and checked.
 */
const ledgerInputs = async (challenge: IAnimChallenge) => {
    const [votes, jury, candidates] = await Promise.all([
        AnimVote.aggregate<{ _id: { c: Types.ObjectId; k: string }; q: number; last: Date }>([
            { $match: { challengeId: challenge._id, status: VoteStatus.COUNTED } },
            { $group: { _id: { c: '$candidateId', k: '$kind' }, q: { $sum: '$quantity' }, last: { $max: '$at' } } },
        ]),
        AnimJuryScore.aggregate<{ _id: Types.ObjectId; avg: number; n: number }>([
            { $match: { challengeId: challenge._id, status: 'SUBMITTED' } },
            { $group: { _id: '$candidateId', avg: { $avg: '$weightedScore' }, n: { $sum: 1 } } },
        ]),
        AnimCandidate.find({ challengeId: challenge._id, status: CandidateStatus.APPROVED }).select('number displayName userId').lean(),
    ]);
    const tally = new Map<string, { free: number; paid: number; last?: Date }>();
    for (const v of votes) {
        const k = String(v._id.c);
        const t = tally.get(k) ?? { free: 0, paid: 0 };
        if (v._id.k === VoteKind.PAID) t.paid += v.q; else t.free += v.q;
        if (!t.last || v.last > t.last) t.last = v.last;
        tally.set(k, t);
    }
    const juryBy = new Map(jury.map((j) => [String(j._id), j]));
    return candidates.map((c) => {
        const t = tally.get(String(c._id)) ?? { free: 0, paid: 0 };
        const j = juryBy.get(String(c._id));
        return {
            candidateId: String(c._id), number: c.number, displayName: c.displayName, userId: String(c.userId),
            freeVotes: t.free, paidVotes: t.paid, juryScore: j ? Math.round(j.avg * 100) / 100 : 0, juryCount: j?.n ?? 0,
            reachedTotalAt: t.last ?? null,
        };
    });
};

const toEntries = (board: ReturnType<typeof computeBoard>, sharedRanks: boolean): ResultEntry[] => {
    let prevScore: number | null = null;
    let prevRank = 0;
    return board.map((e, i) => {
        const shared = sharedRanks && e.tied && prevScore === e.score;
        const rank = shared ? prevRank : i + 1;
        prevScore = e.score;
        prevRank = rank;
        return {
            candidateId: new Types.ObjectId(e.candidateId), number: e.number, displayName: e.displayName, userId: new Types.ObjectId(e.userId),
            freeVotes: e.freeVotes, paidVotes: e.paidVotes, totalVotes: e.totalVotes, juryScore: e.juryScore, score: e.score,
            rank, sharedRank: false,
        };
    }).map((e, _i, all) => ({ ...e, sharedRank: all.filter((x) => x.rank === e.rank).length > 1 }));
};

/** Ties among the ranks that matter (a prize or the podium). */
const findTies = (entries: ResultEntry[], prizeRanks: number[]) => {
    const relevant = new Set([1, 2, 3, ...prizeRanks]);
    const byScore = new Map<number, ResultEntry[]>();
    for (const e of entries) if (e.score > 0) byScore.set(e.score, [...(byScore.get(e.score) ?? []), e]);
    return [...byScore.values()]
        .filter((g) => g.length > 1 && g.some((e) => relevant.has(e.rank)))
        .map((g) => ({ rank: Math.min(...g.map((e) => e.rank)), candidateIds: g.map((e) => e.candidateId) }));
};

/**
 * Computes (or recomputes, until frozen) the result. The tie rule chosen
 * before voting decides what happens to equal scores (§28):
 *  - EARLIEST_TO_REACH: automatic — who reached the total first ranks higher;
 *  - SPLIT_PRIZE: tied candidates share the rank (and the prize);
 *  - JURY_DECIDES / ORGANIZER_DECIDES: the result waits for a recorded decision;
 *  - SECOND_ROUND: the result waits for a run-off challenge.
 */
export const computeResult = async (actor: Actor, challengeId: Types.ObjectId | string) => {
    const challenge = await AnimChallenge.findById(challengeId);
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    const existing = await AnimResult.findOne({ challengeId: challenge._id }).lean();
    if (existing?.status === ResultStatus.FROZEN) return existing;

    const inputs = await ledgerInputs(challenge);
    const board = computeBoard(inputs, challenge.scoring);
    const entries = toEntries(board, challenge.tieRule === TieRule.SPLIT_PRIZE);
    const ties = challenge.tieRule === TieRule.EARLIEST_TO_REACH ? [] : findTies(entries, challenge.rankRewards.map((r) => r.rank));
    let status = ResultStatus.COMPUTED;
    if (ties.length && [TieRule.JURY_DECIDES, TieRule.ORGANIZER_DECIDES].includes(challenge.tieRule)) status = ResultStatus.AWAITING_TIE_DECISION;
    if (ties.length && challenge.tieRule === TieRule.SECOND_ROUND) status = ResultStatus.AWAITING_SECOND_ROUND;
    if (challenge.tieRule === TieRule.SPLIT_PRIZE) status = ResultStatus.COMPUTED;

    const inputsHash = sha256(canonical(inputs.map((i) => ({ c: i.candidateId, f: i.freeVotes, p: i.paidVotes, j: i.juryScore }))));
    // A tie already decided on these exact inputs stands: recomputing would
    // reopen it. Changed inputs (a late refund, a void) do reopen it — the
    // decision was taken on scores that no longer hold.
    if (existing?.tieResolution && existing.inputsHash === inputsHash) return existing;

    const doc = {
        challengeId: challenge._id, eventId: challenge.eventId, organizerId: challenge.organizerId,
        status, computedAt: new Date(),
        configSnapshot: { voting: challenge.voting, scoring: challenge.scoring, tieRule: challenge.tieRule, rankRewards: challenge.rankRewards },
        inputsHash,
        entries, ties,
    };
    const saved = await AnimResult.findOneAndUpdate({ challengeId: challenge._id }, { $set: doc, $unset: { tieResolution: '' } }, { upsert: true, new: true });
    await AnimChallenge.updateOne({ _id: challenge._id }, { $set: { resultId: saved!._id } });
    await audit({ actor, action: 'result.compute', targetType: 'result', targetId: saved!._id, organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id, after: { status, ties: ties.length, inputsHash: doc.inputsHash } });
    return saved;
};

export const getResult = async (challengeId: string, opts: { publicOnly?: boolean } = {}) => {
    const r = await AnimResult.findOne({ challengeId }).lean();
    if (!r) return null;
    if (opts.publicOnly && !r.publishedAt) return null;
    return r;
};

/** The organizer (or jury, per the rule) orders tied candidates. Recorded, audited. */
export const resolveTie = async (ctx: AnimCtx, challengeId: string, body: { rank: number; order: string[]; note?: string }) => {
    const challenge = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    // Lean: entries are spread below, and spreading a subdocument copies
    // Mongoose internals instead of fields (the new rank would be lost).
    const result = await AnimResult.findOne({ challengeId: challenge._id }).lean();
    if (!result || result.status !== ResultStatus.AWAITING_TIE_DECISION) throw new AppError('Aucune égalité à départager.', 409);
    const tie = result.ties.find((t) => t.rank === Number(body.rank));
    if (!tie) throw new AppError('Égalité introuvable.', 404);
    const want = new Set(tie.candidateIds.map(String));
    if (!Array.isArray(body.order) || body.order.length !== want.size || !body.order.every((id) => want.has(id))) {
        throw new AppError('L’ordre doit contenir exactement les candidats à égalité.', 400);
    }
    if (!body.note?.trim()) throw new AppError('Expliquez la décision (elle est publiée avec le résultat).', 400);
    // Reorder the tied block in place.
    const block = result.entries.filter((e) => want.has(String(e.candidateId)));
    const start = Math.min(...block.map((e) => e.rank));
    const reordered = body.order.map((id, i) => ({ ...block.find((e) => String(e.candidateId) === id)!, rank: start + i, sharedRank: false }));
    const others = result.entries.filter((e) => !want.has(String(e.candidateId)));
    const entries = [...others, ...reordered].sort((a, b) => a.rank - b.rank);
    const remainingTies = result.ties.filter((t) => t.rank !== tie.rank);
    await AnimResult.updateOne({ _id: result._id }, {
        $set: {
            entries, ties: remainingTies,
            status: remainingTies.length ? ResultStatus.AWAITING_TIE_DECISION : ResultStatus.COMPUTED,
            tieResolution: { method: challenge.tieRule, decidedBy: new Types.ObjectId(ctx.actorUserId), at: new Date(), note: body.note.trim(), order: body.order.map((id) => new Types.ObjectId(id)) },
        },
    });
    await audit({ actor: ctx, action: 'result.tie_resolved', targetType: 'result', targetId: result._id, challengeId: challenge._id, after: { rank: tie.rank, order: body.order }, reason: body.note });
    return AnimResult.findById(result._id).lean();
};

/** Opens a run-off challenge between tied candidates (SECOND_ROUND). */
export const startSecondRound = async (ctx: AnimCtx, challengeId: string, body: { votingOpensAt: string; votingClosesAt: string }) => {
    const parent = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!parent) throw new AppError('Défi introuvable.', 404);
    const result = await AnimResult.findOne({ challengeId: parent._id });
    if (!result || result.status !== ResultStatus.AWAITING_SECOND_ROUND || !result.ties.length) throw new AppError('Aucun second tour à lancer.', 409);
    if (result.secondRoundChallengeId) return AnimChallenge.findById(result.secondRoundChallengeId);
    const tie = result.ties[0];
    const opens = new Date(body.votingOpensAt);
    const closes = new Date(body.votingClosesAt);
    if (!(opens < closes) || closes <= new Date()) throw new AppError('Dates du second tour invalides.', 400);
    const { createChallenge } = await import('./challenge.service');
    const child = await createChallenge(ctx, {
        name: `${parent.name} — second tour`, description: `Départage des candidats à égalité au rang ${tie.rank}.`,
        rulesText: parent.rulesText,
        schedule: { votingOpensAt: opens, votingClosesAt: closes, settlementGraceMin: parent.schedule.settlementGraceMin },
        participation: { ...parent.participation, requiresApproval: false, maxCandidates: tie.candidateIds.length },
        voting: parent.voting, scoring: parent.scoring, tieRule: TieRule.EARLIEST_TO_REACH,
    });
    await AnimChallenge.updateOne({ _id: child._id }, { $set: { parentChallengeId: parent._id } });
    const { addCandidateByOrganizer } = await import('./candidate.service');
    const cands = await AnimCandidate.find({ _id: { $in: tie.candidateIds } }).lean();
    for (const c of cands) {
        await addCandidateByOrganizer(ctx, String(child._id), { userId: String(c.userId), displayName: c.displayName, photoFileId: c.photoFileId, description: c.description, category: c.category });
    }
    await AnimResult.updateOne({ _id: result._id }, { $set: { secondRoundChallengeId: child._id } });
    await audit({ actor: ctx, action: 'result.second_round', targetType: 'challenge', targetId: child._id, challengeId: parent._id, after: { tiedRank: tie.rank, candidates: cands.length } });
    return AnimChallenge.findById(child._id);
};

/** When a run-off completes, its order settles the parent's tie. */
const settleParentFromSecondRound = async (actor: Actor, child: IAnimChallenge, childResult: IAnimResult) => {
    if (!child.parentChallengeId) return;
    const parentResult = await AnimResult.findOne({ challengeId: child.parentChallengeId, status: ResultStatus.AWAITING_SECOND_ROUND }).lean();
    if (!parentResult) return;
    const tie = parentResult.ties[0];
    const childOrderUsers = childResult.entries.sort((a, b) => a.rank - b.rank).map((e) => String(e.userId));
    const block = parentResult.entries.filter((e) => tie.candidateIds.map(String).includes(String(e.candidateId)));
    const start = Math.min(...block.map((e) => e.rank));
    const reordered = block.slice().sort((a, b) => childOrderUsers.indexOf(String(a.userId)) - childOrderUsers.indexOf(String(b.userId)))
        .map((e, i) => ({ ...e, rank: start + i, sharedRank: false }));
    const others = parentResult.entries.filter((e) => !block.includes(e));
    const remaining = parentResult.ties.slice(1);
    await AnimResult.updateOne({ _id: parentResult._id }, {
        $set: {
            entries: [...others, ...reordered].sort((a, b) => a.rank - b.rank), ties: remaining,
            status: remaining.length ? ResultStatus.AWAITING_SECOND_ROUND : ResultStatus.COMPUTED,
            tieResolution: { method: TieRule.SECOND_ROUND, at: new Date(), note: `Second tour : ${child.name}` },
        },
    });
    await audit({ actor, action: 'result.tie_resolved', targetType: 'result', targetId: parentResult._id, challengeId: child.parentChallengeId, after: { secondRound: String(child._id) } });
};

/**
 * Locks the result for good (§27): final snapshot, rank prizes handed out,
 * challenge COMPLETED. Refused while ties are open or serious fraud flags
 * await review — a frozen result can't be taken back.
 */
export const freezeResult = async (ctx: AnimCtx | Actor, challengeId: string, opts: { eventId?: string } = {}) => {
    const challenge = await AnimChallenge.findOne({ _id: challengeId, ...(opts.eventId ? { eventId: opts.eventId } : {}) });
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    if (challenge.status !== ChallengeStatus.RESULTS_PENDING) throw new AppError('Le résultat se fige après la clôture des votes.', 409, true, 'NOT_RESULTS_PENDING');
    const { blockingFlags } = await import('./fraud.service');
    if (await blockingFlags(challenge._id)) {
        throw new AppError('Des activités suspectes attendent la vérification de l’équipe SBC.', 409, true, 'FRAUD_REVIEW_PENDING');
    }
    // Recompute from the ledger right before freezing (late refunds, voids).
    const current = await AnimResult.findOne({ challengeId: challenge._id }).lean();
    let result: Pick<IAnimResult, '_id' | 'status'> | null = current;
    if (!current || current.status === ResultStatus.COMPUTED) result = await computeResult(ctx as Actor, challenge._id);
    if (!result) throw new AppError('Résultat introuvable.', 404);
    if (result.status !== ResultStatus.COMPUTED) {
        throw new AppError('Des égalités doivent être départagées avant de figer le résultat.', 409, true, 'TIES_PENDING');
    }
    const frozen = await AnimResult.findOneAndUpdate(
        { _id: result._id, status: ResultStatus.COMPUTED },
        { $set: { status: ResultStatus.FROZEN, frozenAt: new Date(), frozenBy: ctx.actorUserId && Types.ObjectId.isValid(ctx.actorUserId) ? new Types.ObjectId(ctx.actorUserId) : undefined } },
        { new: true },
    );
    if (!frozen) throw new AppError('Le résultat a changé entre-temps. Rechargez.', 409, true, 'CONCURRENT_CHANGE');
    await takeSnapshot(challenge, 'FINAL');
    const { awardRankRewards } = await import('./reward.service');
    await awardRankRewards(challenge._id, frozen.entries, ctx as Actor);
    const { transition } = await import('./challenge.service');
    await transition(ctx as Actor, challenge._id, ChallengeStatus.COMPLETED, { reason: 'résultat figé' });
    await audit({ actor: ctx as Actor, action: 'result.freeze', targetType: 'result', targetId: frozen._id, organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id, after: { inputsHash: frozen.inputsHash, podium: frozen.entries.slice(0, 3).map((e) => e.number) } });
    if (challenge.parentChallengeId) await settleParentFromSecondRound(ctx as Actor, challenge, frozen);
    return frozen;
};

/** Makes a frozen result public and tells every candidate their final rank. */
export const publishResult = async (ctx: AnimCtx, challengeId: string) => {
    const challenge = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId }).lean();
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    const result = await AnimResult.findOne({ challengeId: challenge._id }).lean();
    if (!result || result.status !== ResultStatus.FROZEN) throw new AppError('Figez le résultat avant de le publier.', 409, true, 'NOT_FROZEN');
    if (result.publishedAt) return result;
    await AnimResult.updateOne({ _id: result._id }, { $set: { publishedAt: new Date() } });
    await audit({ actor: ctx, action: 'result.publish', targetType: 'result', targetId: result._id, challengeId: challenge._id });
    await Promise.all(result.entries.map((e) => enqueue({
        dedupeKey: `anim-result:${challenge._id}:${e.userId}`, kind: 'anim-result', userId: e.userId, eventId: challenge.eventId,
        subject: `🏆 Résultats — ${challenge.name}`,
        body: e.rank <= 3 ? `Bravo ! Vous terminez ${e.rank === 1 ? '1er' : `${e.rank}e`} de « ${challenge.name} ».` : `Vous terminez ${e.rank}e de « ${challenge.name} ». Merci d’avoir participé !`,
        data: { challengeId: String(challenge._id), rank: e.rank },
    })));
    await markBoardDirty(challenge._id);
    return AnimResult.findById(result._id).lean();
};
