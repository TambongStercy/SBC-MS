import { Types } from 'mongoose';
import logger from '../../../utils/logger';
import { getImpactInvitations } from '../../../services/clients/user.service.client';
import { IImpactEdition, ImpactCandidate, ImpactEdition } from '../models';
import { CandidateStatus, EditionStatus, SEAT_LOST_STATUSES } from '../types';
import { audit, notifyCandidate, SYSTEM, transitionCandidate } from '../lib';

const log = logger.getLogger('ImpactQualification');

/**
 * Qualification (spec §3.2–§3.3).
 *
 * Counting: user-service counts each candidate's valid invitations in the
 * window and says WHEN the required count was reached (time of the N-th paid
 * pack). The job polls only candidates whose filleuls paid since its last pass
 * (`changedSince`), every 10 s, and recounts everyone every 30 min (a reversed
 * activation lowers a count without any new payment). A member can also ask
 * for a recount from their space.
 *
 * Seats: handed out ONLY by `assignSeats`, which runs in the job under the
 * leader lock, so there is a single writer and two seats are never decided at
 * once. Each pass takes the waiting list first (they reached the count before
 * anyone still waiting), then candidates who reached the count, oldest
 * `reachedAt` first. So the order of arrival is the order of the payments, not
 * of our detection; the gap between the two is one poll (≈ 10 s), during which
 * a later-detected but earlier candidate is still placed first if both are
 * seen in the same pass.
 */

const BATCH = 200;
/** Overlap between polls, for subscriptions written just before the cursor. */
const POLL_OVERLAP_MS = 2 * 60_000;
const FULL_RECOUNT_MS = 30 * 60_000;

const COUNTED_STATUSES = [
    CandidateStatus.QUALIFYING, CandidateStatus.WAITLIST, CandidateStatus.OFFICIAL, CandidateStatus.SUSPENDED,
];

export const seatHolders = (editionId: Types.ObjectId) =>
    ImpactCandidate.countDocuments({ editionId, seatNumber: { $exists: true }, status: { $nin: SEAT_LOST_STATUSES } });

export const waitlistHolders = (editionId: Types.ObjectId) =>
    ImpactCandidate.countDocuments({
        editionId,
        $or: [
            { status: CandidateStatus.WAITLIST },
            { status: CandidateStatus.SUSPENDED, suspendedFrom: CandidateStatus.WAITLIST },
        ],
    });

const nextSeq = async (editionId: Types.ObjectId, field: 'seatSeq' | 'waitlistSeq') => {
    const e = await ImpactEdition.findByIdAndUpdate(editionId, { $inc: { [field]: 1 } }, { new: true }).select(field).lean();
    return (e as any)[field] as number;
};

/**
 * Recounts invitations for the edition's candidates in `statuses` (or the
 * given candidate ids). Returns how many candidates were updated. A
 * user-service failure throws and leaves the previous counts in place.
 */
export const refreshInvitations = async (
    edition: IImpactEdition,
    opts: { statuses?: CandidateStatus[]; candidateIds?: Types.ObjectId[]; changedSince?: Date } = {},
): Promise<number> => {
    const filter: Record<string, unknown> = { editionId: edition._id };
    if (opts.candidateIds) filter._id = { $in: opts.candidateIds };
    else filter.status = { $in: opts.statuses ?? COUNTED_STATUSES };
    const cands = await ImpactCandidate.find(filter).select('_id userId').lean();
    let updated = 0;
    for (let i = 0; i < cands.length; i += BATCH) {
        const batch = cands.slice(i, i + BATCH);
        const stats = await getImpactInvitations({
            referrerIds: batch.map((c) => String(c.userId)),
            from: edition.schedule.qualificationOpensAt,
            to: edition.schedule.qualificationClosesAt,
            need: edition.settings.invitationsRequired,
            changedSince: opts.changedSince,
        });
        const byUser = new Map(stats.map((s) => [s.referrerId, s]));
        const now = new Date();
        for (const c of batch) {
            const s = byUser.get(String(c.userId));
            if (!s) continue; // not changed since the cursor
            await ImpactCandidate.updateOne({ _id: c._id }, {
                $set: {
                    'invitations.valid': s.valid,
                    'invitations.pending': s.pending,
                    'invitations.reachedAt': s.reachedAt ? new Date(s.reachedAt) : null,
                    'invitations.checkedAt': now,
                },
            });
            updated++;
        }
    }
    return updated;
};

const unlockedText = (required: number) =>
    `Félicitations ! Tu as atteint les ${required} invitations requises pour participer au SBC Impact Challenge. Ta participation est désormais débloquée.`;

/**
 * Hands out free seats, then waiting-list places, then closes what is full.
 * Must only run in the job (single writer). Returns the number of changes.
 */
export const assignSeats = async (editionId: Types.ObjectId): Promise<number> => {
    const edition = await ImpactEdition.findById(editionId);
    if (!edition) return 0;
    if (edition.status !== EditionStatus.QUALIFICATION && edition.status !== EditionStatus.QUALIFICATION_CLOSED) return 0;
    const { maxCandidates: max, waitlistSize, invitationsRequired } = edition.settings;
    let changes = 0;
    let held = await seatHolders(edition._id);

    // 1) A seat freed up (withdrawal, disqualification): the waiting list first.
    while (held < max) {
        const next = await ImpactCandidate.findOne({ editionId: edition._id, status: CandidateStatus.WAITLIST })
            .sort({ waitlistRank: 1 });
        if (!next) break;
        const seat = await nextSeq(edition._id, 'seatSeq');
        const done = await transitionCandidate(next._id, [CandidateStatus.WAITLIST], CandidateStatus.OFFICIAL, {
            reason: 'Place libérée : premier de la liste d’attente',
            set: { seatNumber: seat, seatAt: new Date() },
        });
        if (!done) continue;
        held++; changes++;
        await audit({ actor: SYSTEM, action: 'candidate.promoted', editionId: edition._id, candidateId: done._id, after: { seatNumber: seat, from: 'WAITLIST' } });
        await notifyCandidate(done, 'impact-promoted', 'SBC Impact Challenge : tu as une place !',
            `Une place s’est libérée : tu es maintenant candidat officiel du SBC Impact Challenge (place n°${seat}). Ouvre ton espace candidat pour la suite.`);
    }

    // 2) Candidates who reached the count, in the order they reached it.
    if (edition.status === EditionStatus.QUALIFICATION) {
        const reached = await ImpactCandidate.find({
            editionId: edition._id, status: CandidateStatus.QUALIFYING, 'invitations.reachedAt': { $ne: null },
        }).sort({ 'invitations.reachedAt': 1, createdAt: 1 });
        let waiting = await waitlistHolders(edition._id);
        for (const c of reached) {
            if (held < max) {
                const seat = await nextSeq(edition._id, 'seatSeq');
                const done = await transitionCandidate(c._id, [CandidateStatus.QUALIFYING], CandidateStatus.OFFICIAL, {
                    reason: `${invitationsRequired} invitations atteintes`,
                    set: { seatNumber: seat, seatAt: new Date() },
                });
                if (!done) continue;
                held++; changes++;
                await audit({ actor: SYSTEM, action: 'candidate.official', editionId: edition._id, candidateId: done._id, after: { seatNumber: seat, reachedAt: c.invitations.reachedAt } });
                await notifyCandidate(done, 'impact-unlocked', 'SBC Impact Challenge : participation débloquée 🎉',
                    `${unlockedText(invitationsRequired)} Tu es le candidat officiel n°${seat}.`);
            } else if (waiting < waitlistSize) {
                const rank = await nextSeq(edition._id, 'waitlistSeq');
                const done = await transitionCandidate(c._id, [CandidateStatus.QUALIFYING], CandidateStatus.WAITLIST, {
                    reason: 'Places toutes prises',
                    set: { waitlistRank: rank, waitlistAt: new Date() },
                });
                if (!done) continue;
                waiting++; changes++;
                await audit({ actor: SYSTEM, action: 'candidate.waitlisted', editionId: edition._id, candidateId: done._id, after: { waitlistRank: rank } });
                await notifyCandidate(done, 'impact-waitlisted', 'SBC Impact Challenge : liste d’attente',
                    `${unlockedText(invitationsRequired)} Les ${max} places sont déjà prises : tu es n°${rank} sur la liste d’attente. Si une place se libère, elle est pour toi.`);
            } else {
                changes += await notSelected(edition._id, c._id, 'Places et liste d’attente complètes');
            }
        }

        // 3) Seats full: no new profiles. Seats and waiting list full: qualification over.
        if (held >= max && !edition.registrationClosedAt) {
            await ImpactEdition.updateOne({ _id: edition._id, registrationClosedAt: { $exists: false } },
                { $set: { registrationClosedAt: new Date(), registrationClosedReason: 'seats_full' } });
            await audit({ actor: SYSTEM, action: 'edition.seats_full', editionId: edition._id });
            changes++;
            if (waitlistSize > 0 && waiting < waitlistSize) {
                const still = await ImpactCandidate.find({ editionId: edition._id, status: CandidateStatus.QUALIFYING }).select('_id userId').lean();
                for (const c of still) {
                    await notifyCandidate(c as any, 'impact-seats-full', 'SBC Impact Challenge : les places sont prises',
                        `Les ${max} places du SBC Impact Challenge sont prises. Tu peux encore entrer sur la liste d’attente (${waitlistSize} places) en atteignant tes ${invitationsRequired} invitations.`);
                }
            }
        }
        if (held >= max && waiting >= waitlistSize) {
            changes += await closeQualification(edition._id, 'full');
        }
    }
    return changes;
};

const notSelected = async (editionId: Types.ObjectId, candidateId: Types.ObjectId, reason: string, why: 'full' | 'ended' = 'full') => {
    const done = await transitionCandidate(candidateId, [CandidateStatus.QUALIFYING], CandidateStatus.NOT_SELECTED, { reason });
    if (!done) return 0;
    await audit({ actor: SYSTEM, action: 'candidate.not_selected', editionId, candidateId, reason });
    const cause = why === 'full' ? 'toutes les places sont prises' : 'la période de qualification est terminée';
    await notifyCandidate(done, 'impact-not-selected', 'SBC Impact Challenge : inscriptions fermées',
        `Les inscriptions au SBC Impact Challenge sont fermées : ${cause}. Merci pour ta participation, et rendez-vous pour suivre et soutenir les candidats !`);
    return 1;
};

/**
 * Ends qualification (date reached, all places taken, or the administration).
 * Candidates who never reached the count are told it is over.
 */
export const closeQualification = async (editionId: Types.ObjectId, reason: 'date' | 'full' | 'admin', by?: string): Promise<number> => {
    const now = new Date();
    // An early close by the administration reaches the job as "date passed";
    // members must still read that it was the administration's decision.
    const prev = await ImpactEdition.findById(editionId).select('registrationClosedReason registrationClosedAt').lean();
    if (prev?.registrationClosedReason === 'admin') reason = 'admin';
    const e = await ImpactEdition.findOneAndUpdate(
        { _id: editionId, status: EditionStatus.QUALIFICATION },
        {
            $set: { status: EditionStatus.QUALIFICATION_CLOSED, registrationClosedAt: prev?.registrationClosedAt ?? now, registrationClosedReason: reason },
            $push: { statusHistory: { from: EditionStatus.QUALIFICATION, to: EditionStatus.QUALIFICATION_CLOSED, at: now, by: by ? new Types.ObjectId(by) : undefined, reason } },
        },
        { new: true },
    );
    if (!e) return 0;
    await audit({ actor: by ? { role: 'admin', userId: by } : SYSTEM, action: 'edition.qualification_closed', editionId, reason });
    const left = await ImpactCandidate.find({ editionId, status: CandidateStatus.QUALIFYING }).select('_id').lean();
    let n = 1;
    for (const c of left) {
        n += reason === 'full'
            ? await notSelected(editionId, c._id, 'Places et liste d’attente complètes', 'full')
            : await notSelected(editionId, c._id, reason === 'admin' ? 'Qualification close par l’administration' : 'Fin de la période de qualification', 'ended');
    }
    log.info(`Edition ${editionId}: qualification closed (${reason}), ${left.length} candidate(s) not selected`);
    return n;
};

/** One job pass over every edition in qualification. */
export const qualificationTick = async (now = new Date()): Promise<number> => {
    const editions = await ImpactEdition.find({ status: { $in: [EditionStatus.QUALIFICATION, EditionStatus.QUALIFICATION_CLOSED] } });
    let changes = 0;
    for (const e of editions) {
        try {
            if (e.status === EditionStatus.QUALIFICATION && now >= e.schedule.qualificationOpensAt) {
                const full = !e.lastFullRecountAt || now.getTime() - e.lastFullRecountAt.getTime() >= FULL_RECOUNT_MS;
                if (full) {
                    await refreshInvitations(e);
                    await ImpactEdition.updateOne({ _id: e._id }, { $set: { lastFullRecountAt: now, pollCursor: now } }, { timestamps: false });
                } else {
                    const since = new Date((e.pollCursor ?? e.schedule.qualificationOpensAt).getTime() - POLL_OVERLAP_MS);
                    await refreshInvitations(e, { statuses: [CandidateStatus.QUALIFYING], changedSince: since });
                    // The job's cursor is not a change of the edition: leave updatedAt alone.
                    await ImpactEdition.updateOne({ _id: e._id }, { $set: { pollCursor: now } }, { timestamps: false });
                }
            }
            changes += await assignSeats(e._id);
            if (e.status === EditionStatus.QUALIFICATION && now > e.schedule.qualificationClosesAt) {
                // Last recount so a payment of the final minutes is not missed, then place and close.
                await refreshInvitations(e, { statuses: [CandidateStatus.QUALIFYING] });
                changes += await assignSeats(e._id);
                changes += await closeQualification(e._id, 'date');
            }
        } catch (err) {
            log.error(`qualification tick for edition ${e._id} failed: ${(err as Error).message}`);
        }
    }
    return changes;
};
