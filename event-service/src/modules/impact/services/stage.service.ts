import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { IImpactEdition, ImpactCandidate, ImpactEdition, ImpactFreeVote, ImpactVoteTx } from '../models';
import {
    CandidateStatus, CompetitionStage, EditionStatus, ProfileReview, RoundKey, RoundStatus, settingsOf, VoteTxStatus,
} from '../types';
import { Actor, audit, notifyCandidate, SYSTEM, transitionCandidate } from '../lib';
import { getEdition, invalidateCurrent } from './edition.service';
import { invalidateBoard } from './board.service';

const log = logger.getLogger('ImpactStages');

/**
 * The competition (spec §5–§9): week 1 presentation, week 2 video + free vote,
 * week 3 projects + paid votes, then the TOP 3. The administration moves from
 * one week to the next (§15 « ouvrir/fermer une étape »); each vote round has
 * dates (the job opens and closes it) and can be opened or closed by hand.
 */

const oid = (v?: string) => (v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : undefined);

/** The stage a round belongs to: the free vote is week 2, the paid votes week 3. */
export const ROUND_STAGE: Record<RoundKey, CompetitionStage> = {
    [RoundKey.FREE]: CompetitionStage.WEEK2,
    [RoundKey.PAID]: CompetitionStage.WEEK3,
    [RoundKey.FINAL]: CompetitionStage.LIVE,
};
/** The edition status a round runs in: weeks 2–3 in COMPETITION, the final vote in FINAL. */
export const ROUND_EDITION_STATUS: Record<RoundKey, EditionStatus> = {
    [RoundKey.FREE]: EditionStatus.COMPETITION,
    [RoundKey.PAID]: EditionStatus.COMPETITION,
    [RoundKey.FINAL]: EditionStatus.FINAL,
};
/** Candidates told when a round opens or closes. */
const ROUND_RACERS: Record<RoundKey, CandidateStatus> = {
    [RoundKey.FREE]: CandidateStatus.STAGE_2,
    [RoundKey.PAID]: CandidateStatus.STAGE_3,
    [RoundKey.FINAL]: CandidateStatus.FINALIST,
};

const roundLabel = (k: RoundKey) => (k === RoundKey.FREE ? 'le vote gratuit' : k === RoundKey.PAID ? 'les votes payants' : 'le vote public de la finale');
const stageLabel = (st: CompetitionStage) => (st === CompetitionStage.WEEK2 ? 'semaine 2' : st === CompetitionStage.WEEK3 ? 'semaine 3' : 'pendant la finale en direct');

const pushStage = (stage: CompetitionStage, by?: string) => ({ stageHistory: { stage, at: new Date(), by: oid(by) } });

/** Candidates currently in the race (suspended ones keep their place). */
const inRace = (editionId: Types.ObjectId, status: CandidateStatus) => ImpactCandidate.find({
    editionId,
    $or: [{ status }, { status: CandidateStatus.SUSPENDED, suspendedFrom: status }],
});

// ---------- Launch: QUALIFICATION_CLOSED → COMPETITION / WEEK1 ----------

/**
 * Starts the competition and publishes the official candidates (§5). Every
 * official profile must have been validated first: they are about to be shown
 * to every member and on SBC's social networks.
 */
export const launchCompetition = async (actor: Actor, id: string) => {
    const e = await getEdition(id);
    if (e.status !== EditionStatus.QUALIFICATION_CLOSED) {
        throw new AppError('La compétition se lance une fois la qualification terminée.', 409, true, 'BAD_STATUS');
    }
    const st = settingsOf(e.settings);
    const officials = await ImpactCandidate.find({ editionId: e._id, status: CandidateStatus.OFFICIAL }).select('_id userId profile.name review').lean();
    if (officials.length < st.finalistsCount) {
        throw new AppError(`Il faut au moins ${st.finalistsCount} candidats officiels.`, 409, true, 'NOT_ENOUGH_CANDIDATES');
    }
    const toReview = officials.filter((c) => c.review?.status !== ProfileReview.APPROVED);
    if (toReview.length) {
        throw new AppError(`${toReview.length} profil(s) officiel(s) à valider avant la publication.`, 409, true, 'PROFILES_TO_REVIEW',
            { candidates: toReview.map((c) => ({ _id: String(c._id), name: c.profile?.name })) });
    }
    const suspended = await ImpactCandidate.countDocuments({ editionId: e._id, status: CandidateStatus.SUSPENDED });
    if (suspended) {
        throw new AppError('Un candidat est suspendu : rétablissez-le ou disqualifiez-le avant de lancer la compétition.', 409, true, 'SUSPENDED_CANDIDATES');
    }
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: EditionStatus.QUALIFICATION_CLOSED },
        {
            $set: { status: EditionStatus.COMPETITION, stage: CompetitionStage.WEEK1, competitionStartedAt: now },
            $push: {
                statusHistory: { from: EditionStatus.QUALIFICATION_CLOSED, to: EditionStatus.COMPETITION, at: now, by: oid(actor.userId) },
                ...pushStage(CompetitionStage.WEEK1, actor.userId),
            },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    await ImpactCandidate.updateMany({ editionId: e._id, status: CandidateStatus.OFFICIAL }, { $set: { publishedAt: now } });
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'edition.competition_started', editionId: e._id, after: { officials: officials.length } });

    // The waiting list will not be called any more.
    const waiting = await ImpactCandidate.find({ editionId: e._id, status: CandidateStatus.WAITLIST }).select('_id').lean();
    for (const w of waiting) {
        const c = await transitionCandidate(w._id, [CandidateStatus.WAITLIST], CandidateStatus.NOT_SELECTED, { by: actor.userId, reason: 'La compétition a commencé' });
        if (c) {
            await audit({ actor: SYSTEM, action: 'candidate.not_selected', editionId: e._id, candidateId: c._id, reason: 'competition started' });
            await notifyCandidate(c, 'impact-not-selected', 'SBC Impact Challenge : la compétition commence',
                'La compétition du SBC Impact Challenge commence avec les candidats officiels : aucune place ne s’est libérée. Merci pour ta participation, et viens soutenir les candidats !');
        }
    }
    for (const c of officials) {
        await notifyCandidate(c as any, 'impact-competition-started', 'SBC Impact Challenge : c’est parti !',
            'La compétition commence : ton profil de candidat est maintenant publié dans l’application. Partage-le autour de toi !');
    }
    return done;
};

// ---------- Weeks ----------

/** WEEK1 → WEEK2 → WEEK3 (the TOP 3 has its own action). */
export const advanceStage = async (actor: Actor, id: string) => {
    const e = await getEdition(id);
    if (e.status !== EditionStatus.COMPETITION) throw new AppError('La compétition n’est pas en cours.', 409, true, 'BAD_STATUS');
    let to: CompetitionStage;
    let from: CandidateStatus;
    let next: CandidateStatus;
    if (e.stage === CompetitionStage.WEEK1) {
        to = CompetitionStage.WEEK2; from = CandidateStatus.OFFICIAL; next = CandidateStatus.STAGE_2;
    } else if (e.stage === CompetitionStage.WEEK2) {
        if (e.rounds?.FREE?.status === RoundStatus.OPEN) {
            throw new AppError('Clôturez d’abord le vote gratuit.', 409, true, 'ROUND_OPEN');
        }
        to = CompetitionStage.WEEK3; from = CandidateStatus.STAGE_2; next = CandidateStatus.STAGE_3;
    } else {
        throw new AppError('Cette étape se termine par la désignation du TOP 3.', 409, true, 'BAD_STATUS');
    }
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: EditionStatus.COMPETITION, stage: e.stage },
        { $set: { stage: to }, $push: pushStage(to, actor.userId) },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');

    const racers = await inRace(e._id, from);
    for (const c of racers) {
        if (c.status === CandidateStatus.SUSPENDED) {
            await ImpactCandidate.updateOne({ _id: c._id, status: CandidateStatus.SUSPENDED }, { $set: { suspendedFrom: next } });
            continue;
        }
        const moved = await transitionCandidate(c._id, [from], next, { by: actor.userId, reason: `Passage à ${to}` });
        if (!moved) continue;
        if (to === CompetitionStage.WEEK2) {
            await notifyCandidate(moved, 'impact-video-requested', 'SBC Impact Challenge : semaine 2',
                'Semaine 2 : dépose ta vidéo « Ma vision de SBC » depuis ton espace candidat. Après validation, elle sera publiée et soumise au vote.');
        } else {
            await notifyCandidate(moved, 'impact-project-requested', 'SBC Impact Challenge : semaine 3',
                'Semaine 3 : présente ton projet depuis ton espace candidat (problème, solution, clientèle, impact…). Les votes payants portent sur les projets publiés.');
        }
    }
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'edition.stage_advanced', editionId: e._id, before: { stage: e.stage }, after: { stage: to } });
    return done;
};

// ---------- Vote rounds ----------

const date = (v: unknown, field: string) => {
    const d = new Date(String(v));
    if (v === undefined || v === null || v === '' || Number.isNaN(d.getTime())) {
        throw new AppError('Date invalide.', 400, true, 'INVALID_SCHEDULE', { field });
    }
    return d;
};

const roundKey = (k: string): RoundKey => {
    if (k !== RoundKey.FREE && k !== RoundKey.PAID && k !== RoundKey.FINAL) throw new AppError('Tour de vote inconnu.', 404);
    return k as RoundKey;
};

/** Sets the dates of a round that has not opened yet. */
export const scheduleRound = async (actor: Actor, id: string, key: string, body: Record<string, any>) => {
    const k = roundKey(key);
    const e = await getEdition(id);
    // Weeks 2–3 are planned until the TOP 3; the final vote until the result.
    const closedFor = k === RoundKey.FINAL
        ? [EditionStatus.CANCELLED, EditionStatus.FINISHED]
        : [EditionStatus.CANCELLED, EditionStatus.FINISHED, EditionStatus.FINAL];
    if (closedFor.includes(e.status)) {
        throw new AppError('Cette édition ne programme plus ce vote.', 409, true, 'BAD_STATUS');
    }
    const r = e.rounds?.[k];
    if (r && r.status !== RoundStatus.SCHEDULED) throw new AppError('Ce vote est déjà ouvert ou clos : ses dates ne changent plus.', 409, true, 'ROUND_STARTED');
    const opensAt = date(body.opensAt, `rounds.${k}.opensAt`);
    const closesAt = date(body.closesAt, `rounds.${k}.closesAt`);
    if (closesAt <= opensAt) throw new AppError('Le vote doit se terminer après son ouverture.', 400, true, 'INVALID_SCHEDULE', { field: `rounds.${k}.closesAt` });
    if (closesAt <= new Date()) throw new AppError('La fin du vote est déjà passée.', 400, true, 'INVALID_SCHEDULE', { field: `rounds.${k}.closesAt` });
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, $or: [{ [`rounds.${k}.status`]: RoundStatus.SCHEDULED }, { [`rounds.${k}.status`]: { $exists: false } }] },
        { $set: { [`rounds.${k}.status`]: RoundStatus.SCHEDULED, [`rounds.${k}.opensAt`]: opensAt, [`rounds.${k}.closesAt`]: closesAt } },
        { new: true },
    );
    if (!done) throw new AppError('Le vote a changé entre-temps. Rechargez la page.', 409, true, 'ROUND_STARTED');
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'round.scheduled', editionId: e._id, after: { round: k, opensAt, closesAt } });
    return done;
};

const openRound = async (e: IImpactEdition, k: RoundKey, actor: Actor) => {
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, status: ROUND_EDITION_STATUS[k], stage: ROUND_STAGE[k], [`rounds.${k}.status`]: RoundStatus.SCHEDULED, [`rounds.${k}.closesAt`]: { $gt: now } },
        { $set: { [`rounds.${k}.status`]: RoundStatus.OPEN, [`rounds.${k}.openedAt`]: now } },
        { new: true },
    );
    if (!done) return null;
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'round.opened', editionId: e._id, after: { round: k } });
    const racers = await ImpactCandidate.find({ editionId: e._id, status: ROUND_RACERS[k] }).select('_id userId').lean();
    for (const c of racers) {
        await notifyCandidate(c as any, 'impact-votes-open', 'SBC Impact Challenge : les votes sont ouverts',
            `C’est le moment : ${roundLabel(k)} est ouvert. Partage ton lien pour que ta communauté vote pour toi !`);
    }
    return done;
};

const closeRound = async (e: IImpactEdition, k: RoundKey, actor: Actor, reason?: string) => {
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: e._id, [`rounds.${k}.status`]: RoundStatus.OPEN },
        { $set: { [`rounds.${k}.status`]: RoundStatus.CLOSED, [`rounds.${k}.closedAt`]: now } },
        { new: true },
    );
    if (!done) return null;
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'round.closed', editionId: e._id, after: { round: k }, reason });
    const racers = await ImpactCandidate.find({ editionId: e._id, status: ROUND_RACERS[k] }).select('_id userId').lean();
    for (const c of racers) {
        await notifyCandidate(c as any, 'impact-votes-closed', 'SBC Impact Challenge : les votes sont clos',
            k === RoundKey.FREE
                ? 'Le vote gratuit est clos. Merci à ta communauté ! Prépare maintenant la présentation de ton projet.'
                : k === RoundKey.PAID
                    ? 'Les votes payants sont clos. Le TOP 3 sera annoncé très bientôt.'
                    : 'Le vote public de la finale est clos. Le résultat sera annoncé à la fin du direct.');
    }
    return done;
};

/** « Lancer les votes » now (the round's end date must already be set and ahead). */
export const openRoundNow = async (actor: Actor, id: string, key: string) => {
    const k = roundKey(key);
    const e = await getEdition(id);
    if (e.stage !== ROUND_STAGE[k] || e.status !== ROUND_EDITION_STATUS[k]) throw new AppError(`Ce vote s’ouvre ${ROUND_STAGE[k] === CompetitionStage.LIVE ? '' : 'en '}${stageLabel(ROUND_STAGE[k])}.`, 409, true, 'WRONG_STAGE');
    if (!e.rounds?.[k]?.closesAt) throw new AppError('Programmez d’abord la fin du vote.', 409, true, 'ROUND_NOT_SCHEDULED');
    const r = e.rounds[k];
    if (r.status !== RoundStatus.SCHEDULED) throw new AppError('Ce vote est déjà ouvert ou clos.', 409, true, 'ROUND_STARTED');
    if (r.closesAt! <= new Date()) {
        throw new AppError('La fin du vote est déjà passée : changez-la avant d’ouvrir.', 400, true, 'INVALID_SCHEDULE', { field: `rounds.${k}.closesAt` });
    }
    const done = await openRound(e, k, actor);
    if (!done) throw new AppError('Le vote a changé entre-temps. Rechargez la page.', 409, true, 'ROUND_NOT_OPENABLE');
    return done;
};

/** « Fermer les votes » now. */
export const closeRoundNow = async (actor: Actor, id: string, key: string, reason: string) => {
    const k = roundKey(key);
    if (String(reason ?? '').trim().length < 5) throw new AppError('Indiquez la raison (5 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const e = await getEdition(id);
    const done = await closeRound(e, k, actor, reason);
    if (!done) throw new AppError('Ce vote n’est pas ouvert.', 409, true, 'ROUND_NOT_OPEN');
    return done;
};

/** Job: opens and closes rounds on their dates. */
export const roundTick = async (now = new Date()): Promise<number> => {
    const editions = await ImpactEdition.find({ status: { $in: [EditionStatus.COMPETITION, EditionStatus.FINAL] } });
    let n = 0;
    for (const e of editions) {
        for (const k of [RoundKey.FREE, RoundKey.PAID, RoundKey.FINAL]) {
            const r = e.rounds?.[k];
            if (!r) continue;
            try {
                if (r.status === RoundStatus.SCHEDULED && r.opensAt && r.opensAt <= now && r.closesAt && r.closesAt > now
                    && e.stage === ROUND_STAGE[k] && e.status === ROUND_EDITION_STATUS[k]) {
                    if (await openRound(e, k, SYSTEM)) n++;
                } else if (r.status === RoundStatus.OPEN && r.closesAt && r.closesAt <= now) {
                    if (await closeRound(e, k, SYSTEM, 'date de fin atteinte')) n++;
                }
            } catch (err) {
                log.error(`round tick ${e._id} ${k}: ${(err as Error).message}`);
            }
        }
    }
    return n;
};

// ---------- Counters (the ledgers are the truth) ----------

/** Recomputes every candidate's vote counters from the two ledgers. */
export const recountVotes = async (editionId: Types.ObjectId): Promise<number> => {
    const [free, paid] = await Promise.all([
        ImpactFreeVote.aggregate([
            { $match: { editionId } },
            { $group: { _id: '$candidateId', n: { $sum: 1 }, last: { $max: '$at' } } },
        ]),
        ImpactVoteTx.aggregate([
            { $match: { editionId, status: VoteTxStatus.SUCCESS, votesCreditedAt: { $exists: true }, lateSettlement: { $ne: true } } },
            { $group: { _id: '$candidateId', votes: { $sum: '$votes' }, amount: { $sum: '$amount' }, last: { $max: '$votesCreditedAt' } } },
        ]),
    ]);
    const f = new Map(free.map((r) => [String(r._id), r]));
    const p = new Map(paid.map((r) => [String(r._id), r]));
    const cands = await ImpactCandidate.find({ editionId, seatNumber: { $exists: true } }).select('_id votes').lean();
    let changed = 0;
    for (const c of cands) {
        const fr = f.get(String(c._id));
        const pr = p.get(String(c._id));
        const next = {
            free: fr?.n ?? 0, paid: pr?.votes ?? 0, paidAmount: pr?.amount ?? 0,
            lastFreeAt: fr?.last ?? null, lastPaidAt: pr?.last ?? null,
        };
        const cur = c.votes ?? ({} as any);
        if (cur.free !== next.free || cur.paid !== next.paid || cur.paidAmount !== next.paidAmount
            || (cur.lastPaidAt?.getTime?.() ?? null) !== (next.lastPaidAt?.getTime?.() ?? null)) {
            await ImpactCandidate.updateOne({ _id: c._id }, { $set: { votes: next } });
            changed++;
        }
    }
    if (changed) log.warn(`Edition ${editionId}: ${changed} candidate counter(s) corrected from the ledgers`);
    return changed;
};

// ---------- TOP 3 (§9) ----------

interface RankRow {
    candidateId: string; name: string; projectName: string; seatNumber?: number;
    status: CandidateStatus; paidVotes: number; paidAmount: number; freeVotes: number; lastPaidAt: Date | null;
    rank: number; finalist: boolean;
}

/**
 * The ranking by paid votes (Rufus: the TOP 3 comes from the week-3 paid votes
 * only). Ties go to the candidate who reached the total first (the time of
 * their last counted vote), then to the earlier seat. Recounts from the
 * ledgers first, so the decision never rests on a drifted counter.
 */
export const top3Preview = async (id: string, opts: { recount?: boolean } = {}) => {
    const e = await getEdition(id);
    const st = settingsOf(e.settings);
    // Once decided, the podium is the frozen one (with its names), never recomputed.
    if (e.top3?.decidedAt) {
        return {
            ranking: e.top3.ranking.map((r: any) => ({
                candidateId: String(r.candidateId), name: r.name ?? null, projectName: r.projectName ?? null, seatNumber: r.seatNumber ?? null,
                status: r.finalist ? CandidateStatus.FINALIST : CandidateStatus.ELIMINATED, paidVotes: r.paidVotes, paidAmount: r.paidAmount ?? null,
                freeVotes: r.freeVotes ?? null, lastPaidAt: r.lastPaidAt ?? null, rank: r.rank, finalist: r.finalist,
            })),
            finalistsCount: st.finalistsCount, tieAtCut: false, blockers: [], flaggedPurchases: 0, decided: true,
            decidedAt: e.top3.decidedAt,
        };
    }
    // A read does not write: the ledgers are recounted only when asked (« Recompter ») and
    // always by the confirmation itself.
    if (opts.recount) await recountVotes(e._id);
    const racers = await ImpactCandidate.find({
        editionId: e._id,
        $or: [{ status: CandidateStatus.STAGE_3 }, { status: CandidateStatus.SUSPENDED, suspendedFrom: CandidateStatus.STAGE_3 }],
    }).lean();
    const sorted = racers.sort((a, b) =>
        (b.votes?.paid ?? 0) - (a.votes?.paid ?? 0)
        || (a.votes?.lastPaidAt ? a.votes.lastPaidAt.getTime() : Infinity) - (b.votes?.lastPaidAt ? b.votes.lastPaidAt.getTime() : Infinity)
        || (a.seatNumber ?? 0) - (b.seatNumber ?? 0));
    const ranking: RankRow[] = sorted.map((c, i) => ({
        candidateId: String(c._id), name: c.profile.name, projectName: c.profile.projectName, seatNumber: c.seatNumber,
        status: c.status, paidVotes: c.votes?.paid ?? 0, paidAmount: c.votes?.paidAmount ?? 0, freeVotes: c.votes?.free ?? 0,
        lastPaidAt: c.votes?.lastPaidAt ?? null, rank: i + 1, finalist: i < st.finalistsCount,
    }));
    const cutoff = ranking[st.finalistsCount - 1];
    const firstOut = ranking[st.finalistsCount];
    const tieAtCut = Boolean(cutoff && firstOut && cutoff.paidVotes === firstOut.paidVotes);

    const blockers: { code: string; message: string; until?: Date }[] = [];
    if (e.status !== EditionStatus.COMPETITION || e.stage !== CompetitionStage.WEEK3) {
        blockers.push({ code: 'WRONG_STAGE', message: 'Le TOP 3 se désigne en fin de semaine 3.' });
    }
    const paid = e.rounds?.PAID;
    if (paid?.status !== RoundStatus.CLOSED) blockers.push({ code: 'ROUND_OPEN', message: 'Les votes payants ne sont pas clos.' });
    const graceEnd = paid?.closedAt ? paid.closedAt.getTime() + st.settlementGraceMin * 60_000 : null;
    if (graceEnd && Date.now() < graceEnd) {
        const pending = await ImpactVoteTx.countDocuments({ editionId: e._id, status: VoteTxStatus.PENDING, createdAt: { $lt: paid!.closedAt } });
        if (pending) blockers.push({ code: 'PAYMENTS_SETTLING', message: `${pending} paiement(s) lancé(s) avant la clôture en cours de confirmation : attendez la fin du délai de ${st.settlementGraceMin} minutes.`, until: new Date(graceEnd) });
    }
    if (ranking.some((r) => r.status === CandidateStatus.SUSPENDED)) {
        blockers.push({ code: 'SUSPENDED_CANDIDATES', message: 'Un candidat est suspendu : rétablissez-le ou disqualifiez-le d’abord.' });
    }
    if (ranking.length < st.finalistsCount) blockers.push({ code: 'NOT_ENOUGH_CANDIDATES', message: `Moins de ${st.finalistsCount} candidats en course.` });
    const flagged = await ImpactVoteTx.countDocuments({ editionId: e._id, flags: { $ne: [] }, status: VoteTxStatus.SUCCESS });
    return { ranking, finalistsCount: st.finalistsCount, tieAtCut, blockers, flaggedPurchases: flagged, decided: false, decidedAt: null };
};

/**
 * Freezes the TOP 3 (admin code required at the route). `expectedOrder` = the
 * candidate ids in the order the admin saw: a ranking that moved since is
 * refused, so nobody confirms a podium they did not read.
 */
export const top3Confirm = async (actor: Actor, id: string, body: Record<string, any>) => {
    const preview = await top3Preview(id, { recount: true });
    if (preview.decided) throw new AppError('Le TOP 3 est déjà désigné.', 409, true, 'ALREADY_DECIDED');
    if (preview.blockers.length) throw new AppError(preview.blockers[0].message, 409, true, preview.blockers[0].code, { blockers: preview.blockers });
    const seen: string[] = Array.isArray(body?.expectedOrder) ? body.expectedOrder.map(String) : [];
    if (!seen.length || seen.join(',') !== preview.ranking.map((r) => r.candidateId).join(',')) {
        throw new AppError('Le classement a changé depuis votre lecture. Rechargez-le avant de confirmer.', 409, true, 'STALE');
    }
    const now = new Date();
    const done = await ImpactEdition.findOneAndUpdate(
        { _id: oid(id), status: EditionStatus.COMPETITION, stage: CompetitionStage.WEEK3, 'top3.decidedAt': { $exists: false } },
        {
            $set: {
                status: EditionStatus.FINAL, stage: CompetitionStage.TOP3,
                top3: {
                    decidedAt: now, by: oid(actor.userId),
                    ranking: preview.ranking.map((r) => ({
                        candidateId: new Types.ObjectId(r.candidateId), rank: r.rank, paidVotes: r.paidVotes, lastPaidAt: r.lastPaidAt, finalist: r.finalist,
                        name: r.name, projectName: r.projectName, seatNumber: r.seatNumber, paidAmount: r.paidAmount, freeVotes: r.freeVotes,
                    })),
                },
            },
            $push: {
                statusHistory: { from: EditionStatus.COMPETITION, to: EditionStatus.FINAL, at: now, by: oid(actor.userId), reason: 'TOP 3 désigné' },
                ...pushStage(CompetitionStage.TOP3, actor.userId),
            },
        },
        { new: true },
    );
    if (!done) throw new AppError('L’édition a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    for (const r of preview.ranking) {
        const c = await transitionCandidate(r.candidateId, [CandidateStatus.STAGE_3], r.finalist ? CandidateStatus.FINALIST : CandidateStatus.ELIMINATED, {
            by: actor.userId, reason: `Rang ${r.rank} aux votes payants (${r.paidVotes} votes)`, set: { rank: r.rank },
        });
        if (!c) continue;
        if (r.finalist) {
            await notifyCandidate(c, 'impact-finalist', 'SBC Impact Challenge : tu es finaliste ! 🏆',
                `Bravo ! Avec ${r.paidVotes} votes, tu es ${r.rank === 1 ? '1er' : `${r.rank}e`} et tu fais partie du TOP ${preview.finalistsCount}. Rendez-vous pour la grande finale en direct.`);
        } else {
            await notifyCandidate(c, 'impact-not-finalist', 'SBC Impact Challenge : résultats de la semaine 3',
                `Tu termines ${r.rank}e avec ${r.paidVotes} votes. Tu ne fais pas partie du TOP ${preview.finalistsCount} cette fois : merci pour ton engagement dans le SBC Impact Challenge !`);
        }
    }
    invalidateCurrent(); invalidateBoard();
    await audit({ actor, action: 'edition.top3_decided', editionId: done._id, after: { ranking: preview.ranking.map((r) => ({ c: r.candidateId, rank: r.rank, votes: r.paidVotes })) } });
    return { edition: done, ranking: preview.ranking };
};
