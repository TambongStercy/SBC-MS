import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { getEventUserDetails, getImpactMembers, ImpactMember } from '../../../services/clients/user.service.client';
import { IImpactCandidate, IImpactEdition, ImpactAudit, ImpactCandidate, ImpactEdition } from '../models';
import {
    CandidateStatus, CONSENT_VERSION, EditionStatus, editionRank, ProfileReview, SEAT_LOST_STATUSES, STATUS_LABEL_FR,
} from '../types';
import {
    Actor, audit, isRegistrationOpen, notifyCandidate, parseProfile, publicEdition, timeOf, transitionCandidate,
} from '../lib';
import { currentEdition, getEdition } from './edition.service';
import { refreshInvitations, seatHolders } from './qualification.service';
import { invalidateBoard } from './board.service';
import { currentSubmissions } from './submission.service';

const log = logger.getLogger('ImpactCandidates');

const oid = (v: string, what = 'Candidat') => {
    if (!Types.ObjectId.isValid(v)) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(v);
};

const reasonOf = (body: Record<string, any>, min = 5) => {
    const r = String(body?.reason ?? '').trim();
    if (r.length < min) throw new AppError(`Indiquez la raison (${min} caractères au moins).`, 400, true, 'REASON_REQUIRED');
    return r.slice(0, 1000);
};

/** The candidate as the member (or an admin) sees it. */
export const presentCandidate = (c: IImpactCandidate, e: IImpactEdition) => ({
    _id: String(c._id),
    editionId: String(c.editionId),
    userId: String(c.userId),
    sbcId: c.sbcId ?? null,
    profile: c.profile,
    status: c.status,
    statusLabel: STATUS_LABEL_FR[c.status],
    suspendedFrom: c.suspendedFrom ?? null,
    invitations: {
        valid: c.invitations?.valid ?? 0,
        pending: c.invitations?.pending ?? 0,
        required: e.settings.invitationsRequired,
        reachedAt: c.invitations?.reachedAt ?? null,
        checkedAt: c.invitations?.checkedAt ?? null,
    },
    seatNumber: c.seatNumber ?? null,
    seatAt: c.seatAt ?? null,
    waitlistRank: c.waitlistRank ?? null,
    votes: { free: c.votes?.free ?? 0, paid: c.votes?.paid ?? 0, paidAmount: c.votes?.paidAmount ?? 0 },
    rank: c.rank ?? null,
    publishedAt: c.publishedAt ?? null,
    review: c.review,
    profileUpdatedAt: c.profileUpdatedAt,
    statusHistory: c.statusHistory,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
});

const memberOf = async (userId: string): Promise<ImpactMember | undefined> => {
    try {
        const [m] = await getImpactMembers([userId]);
        return m;
    } catch (err) {
        log.error(`member lookup for ${userId} failed: ${(err as Error).message}`);
        throw new AppError('Vérification de votre compte impossible pour le moment. Réessayez dans un instant.', 503, true, 'MEMBER_CHECK_UNAVAILABLE');
    }
};

/** Why a member cannot apply right now, or null. */
const applyBlocker = (e: IImpactEdition | null, now = new Date()): { code: string; message: string } | null => {
    if (!e) return { code: 'NO_EDITION', message: 'Aucune édition du SBC Impact Challenge n’est ouverte pour le moment.' };
    if (e.status === EditionStatus.QUALIFICATION && now < e.schedule.qualificationOpensAt) {
        return { code: 'NOT_OPEN_YET', message: 'Les inscriptions ne sont pas encore ouvertes.' };
    }
    if (!isRegistrationOpen(e, now)) return { code: 'REGISTRATION_CLOSED', message: 'INSCRIPTIONS FERMÉES : toutes les places sont prises ou la qualification est terminée.' };
    return null;
};

// ---------- Member ----------

/** A profile can be edited, or the candidacy withdrawn, only in these statuses (and before the competition). */
const EDITABLE_STATUSES = [CandidateStatus.QUALIFYING, CandidateStatus.WAITLIST, CandidateStatus.OFFICIAL];

/** The member's space: the current edition, their candidacy, and whether they can apply. */
export const mySpace = async (userId: string) => {
    const e = await currentEdition();
    if (!e) return { edition: null, candidacy: null, submissions: null, canApply: false, blocker: applyBlocker(null), canEdit: false, canWithdraw: false };
    const [c, taken] = await Promise.all([
        ImpactCandidate.findOne({ editionId: e._id, userId: oid(userId, 'Membre') }),
        seatHolders(e._id),
    ]);
    const blocker = c ? null : applyBlocker(e);
    const beforeCompetition = editionRank(e.status) < editionRank(EditionStatus.COMPETITION);
    return {
        edition: publicEdition(e, taken),
        candidacy: c ? presentCandidate(c, e) : null,
        submissions: c ? await currentSubmissions(c._id) : null,
        canApply: !c && !blocker,
        blocker,
        // The same rules updateMine / withdrawMine apply, so the app never guesses them.
        canEdit: Boolean(c) && beforeCompetition && EDITABLE_STATUSES.includes(c!.status),
        canWithdraw: Boolean(c) && beforeCompetition && EDITABLE_STATUSES.includes(c!.status),
    };
};

export const apply = async (userId: string, body: Record<string, any>) => {
    const e = await currentEdition();
    const blocker = applyBlocker(e);
    if (blocker) throw new AppError(blocker.message, 409, true, blocker.code);
    return createCandidacy(e!, userId, body, { role: 'member', userId });
};

/** Shared by the member's own application and the administration's « ajouter ». */
const createCandidacy = async (e: IImpactEdition, userId: string, body: Record<string, any>, actor: Actor) => {
    if (body.consent !== true) {
        throw new AppError('Acceptez la publication de votre profil, de votre photo et de vos vidéos pour participer.', 400, true, 'CONSENT_REQUIRED');
    }
    const member = await memberOf(userId);
    if (!member || member.unavailable) throw new AppError('Ce compte ne peut pas participer.', 403, true, 'ACCOUNT_UNAVAILABLE');
    if (!member.isMember) {
        throw new AppError('Le SBC Impact Challenge est réservé aux membres SBC avec un pack actif.', 403, true, 'NOT_A_MEMBER');
    }
    const profile = parseProfile(body, e.settings);
    let c: IImpactCandidate;
    try {
        c = await ImpactCandidate.create({
            editionId: e._id,
            userId: new Types.ObjectId(userId),
            sbcId: member.referralCode,
            profile,
            consent: { at: new Date(), version: CONSENT_VERSION },
            statusHistory: [{ from: '', to: CandidateStatus.QUALIFYING, at: new Date(), by: actor.userId ? new Types.ObjectId(actor.userId) : undefined }],
        });
    } catch (err: any) {
        if (err?.code === 11000) throw new AppError('Une candidature existe déjà pour ce compte dans cette édition.', 409, true, 'ALREADY_CANDIDATE');
        throw err;
    }
    await audit({ actor, action: actor.role === 'admin' ? 'candidate.added_by_admin' : 'candidate.applied', editionId: e._id, candidateId: c._id, after: profile });
    // Count the invitations already made, so the space opens with the right number.
    try {
        await refreshInvitations(e, { candidateIds: [c._id] });
    } catch (err) {
        log.warn(`first count for candidate ${c._id} failed: ${(err as Error).message}`);
    }
    const fresh = (await ImpactCandidate.findById(c._id))!;
    return presentCandidate(fresh, e);
};

const myCandidacy = async (userId: string) => {
    const e = await currentEdition();
    if (!e) throw new AppError('Aucune édition en cours.', 404, true, 'NO_EDITION');
    const c = await ImpactCandidate.findOne({ editionId: e._id, userId: oid(userId, 'Membre') });
    if (!c) throw new AppError('Vous n’avez pas de candidature dans cette édition.', 404, true, 'NO_CANDIDACY');
    return { e, c };
};


/**
 * The member edits their profile until the competition starts. A profile the
 * administration had validated goes back to review.
 */
export const updateMine = async (userId: string, body: Record<string, any>) => {
    const { e, c } = await myCandidacy(userId);
    if (editionRank(e.status) >= editionRank(EditionStatus.COMPETITION) || !EDITABLE_STATUSES.includes(c.status)) {
        throw new AppError('Votre profil ne peut plus être modifié.', 409, true, 'PROFILE_LOCKED');
    }
    const before = c.profile;
    const profile = parseProfile(body, e.settings, c.profile);
    const review = c.review.status === ProfileReview.APPROVED || c.review.status === ProfileReview.CHANGES_REQUESTED
        ? { status: ProfileReview.PENDING, reason: undefined, at: undefined, by: undefined }
        : c.review;
    const done = await ImpactCandidate.findOneAndUpdate(
        { _id: c._id, status: { $in: EDITABLE_STATUSES } },
        { $set: { profile, review, profileUpdatedAt: new Date() } },
        { new: true },
    );
    if (!done) throw new AppError('Votre profil ne peut plus être modifié.', 409, true, 'PROFILE_LOCKED');
    await audit({ actor: { role: 'member', userId }, action: 'candidate.profile_updated', editionId: e._id, candidateId: c._id, before, after: profile });
    return presentCandidate(done, e);
};

/** Recount now (the job does it every few seconds anyway). Rate-limited by the route. */
export const refreshMine = async (userId: string) => {
    const { e, c } = await myCandidacy(userId);
    if (e.status === EditionStatus.QUALIFICATION) {
        try {
            await refreshInvitations(e, { candidateIds: [c._id] });
        } catch (err) {
            log.warn(`refresh for candidate ${c._id} failed: ${(err as Error).message}`);
            throw new AppError('Le compteur ne peut pas être mis à jour pour le moment. Réessayez dans un instant.', 503, true, 'COUNTER_UNAVAILABLE');
        }
    }
    return presentCandidate((await ImpactCandidate.findById(c._id))!, e);
};

/** The member leaves the Challenge (before the competition). A freed seat goes to the waiting list. */
export const withdrawMine = async (userId: string) => {
    const { e, c } = await myCandidacy(userId);
    if (editionRank(e.status) >= editionRank(EditionStatus.COMPETITION)) {
        throw new AppError('La compétition a commencé : contactez le support pour vous retirer.', 409, true, 'TOO_LATE');
    }
    const done = await transitionCandidate(c._id, EDITABLE_STATUSES, CandidateStatus.WITHDRAWN, { by: userId, reason: 'Retrait du candidat' });
    if (!done) throw new AppError('Votre candidature ne peut pas être retirée dans son état actuel.', 409, true, 'BAD_STATUS');
    await audit({ actor: { role: 'member', userId }, action: 'candidate.withdrawn', editionId: e._id, candidateId: c._id, before: { status: c.status } });
    return presentCandidate(done, e);
};

// ---------- Administration ----------

const loadForAdmin = async (id: string) => {
    const c = await ImpactCandidate.findById(oid(id));
    if (!c) throw new AppError('Candidat introuvable.', 404);
    const e = await ImpactEdition.findById(c.editionId);
    if (!e) throw new AppError('Édition introuvable.', 404);
    return { c, e };
};

export const listCandidates = async (editionId: string, q: Record<string, any>) => {
    const e = await getEdition(editionId);
    const required = e.settings.invitationsRequired;
    const filter: Record<string, unknown> = { editionId: e._id };
    if (q.status && Object.values(CandidateStatus).includes(q.status)) filter.status = q.status;
    if (q.review && Object.values(ProfileReview).includes(q.review)) filter['review.status'] = q.review;
    // Seat holders whose count fell back below the requirement (a reversed activation).
    const belowFilter = {
        seatNumber: { $exists: true }, status: { $nin: SEAT_LOST_STATUSES }, 'invitations.valid': { $lt: required },
    };
    if (q.below === '1' || q.below === 'true') Object.assign(filter, belowFilter);
    if (q.q) {
        const term = String(q.q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (term) filter.$or = [{ 'profile.name': new RegExp(term, 'i') }, { 'profile.projectName': new RegExp(term, 'i') }, { sbcId: new RegExp(term, 'i') }];
    }
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    // Seats first (arrival order), then the waiting list, then everyone else by
    // progress. A plain sort would put the candidates WITHOUT a seat first (a
    // missing field sorts before any number), hence the computed keys.
    const [rows, total, counts, below] = await Promise.all([
        ImpactCandidate.aggregate([
            { $match: filter },
            {
                $addFields: {
                    _noSeat: { $cond: [{ $gt: ['$seatNumber', null] }, 0, 1] },
                    _noRank: { $cond: [{ $gt: ['$waitlistRank', null] }, 0, 1] },
                },
            },
            { $sort: { _noSeat: 1, seatNumber: 1, _noRank: 1, waitlistRank: 1, 'invitations.valid': -1, createdAt: 1, _id: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: { _noSeat: 0, _noRank: 0 } },
        ]),
        ImpactCandidate.countDocuments(filter),
        ImpactCandidate.aggregate([{ $match: { editionId: e._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        ImpactCandidate.countDocuments({ editionId: e._id, ...belowFilter }),
    ]);
    return {
        items: rows.map((c: IImpactCandidate) => ({
            ...presentCandidate(c, e),
            belowRequirement: Boolean(c.seatNumber) && !SEAT_LOST_STATUSES.includes(c.status) && (c.invitations?.valid ?? 0) < required,
        })),
        total, page, limit,
        byStatus: Object.fromEntries(counts.map((r) => [r._id, r.n])),
        belowRequirementCount: below,
        seats: { taken: await seatHolders(e._id), max: e.settings.maxCandidates },
    };
};

/** Adds `actorName` to admin entries (members' names are their own profile; the system has none). */
const withActorNames = async <T extends { actorUserId?: unknown; actorRole: string }>(rows: T[]) => {
    const ids = [...new Set(rows.filter((r) => r.actorRole === 'admin' && r.actorUserId).map((r) => String(r.actorUserId)))];
    let names = new Map<string, string>();
    if (ids.length) {
        try {
            names = new Map((await getEventUserDetails(ids)).map((u) => [String(u._id), u.name ?? '']));
        } catch (err) {
            log.warn(`audit actor names: ${(err as Error).message}`);
        }
    }
    return rows.map((r) => ({ ...r, actorName: r.actorUserId ? names.get(String(r.actorUserId)) || null : null }));
};

export const getCandidateForAdmin = async (id: string) => {
    const { c, e } = await loadForAdmin(id);
    const trail = await ImpactAudit.find({ candidateId: c._id }).sort({ at: -1, _id: -1 }).limit(200).lean();
    return { candidate: presentCandidate(c, e), edition: { _id: String(e._id), name: e.name, status: e.status }, audit: await withActorNames(trail) };
};

/**
 * The admin decides on the profile they read: when the page sends the
 * `profileUpdatedAt` it showed, a profile changed since is refused.
 */
const expectSameProfile = (c: IImpactCandidate, body: Record<string, any>) => {
    if (body?.profileUpdatedAt === undefined) return;
    const seen = timeOf(body.profileUpdatedAt);
    if (seen !== c.profileUpdatedAt?.getTime()) {
        throw new AppError('Le profil a été modifié depuis votre lecture. Rechargez-le avant de décider.', 409, true, 'STALE');
    }
};

export const reviewProfile = async (actor: Actor, id: string, body: Record<string, any>) => {
    const { c, e } = await loadForAdmin(id);
    const decision = body?.decision;
    if (decision !== 'approve' && decision !== 'changes') throw new AppError('Décision : approve ou changes.', 400, true, 'BAD_DECISION');
    if (c.status === CandidateStatus.DISQUALIFIED || c.status === CandidateStatus.WITHDRAWN) {
        throw new AppError('Cette candidature est close : son profil ne se valide plus.', 409, true, 'BAD_STATUS');
    }
    const reason = decision === 'changes' ? reasonOf(body, 10) : (body?.reason ? String(body.reason).slice(0, 1000) : undefined);
    const status = decision === 'approve' ? ProfileReview.APPROVED : ProfileReview.CHANGES_REQUESTED;
    expectSameProfile(c, body);
    const done = await ImpactCandidate.findOneAndUpdate(
        { _id: c._id, profileUpdatedAt: c.profileUpdatedAt },
        { $set: { review: { status, reason, at: new Date(), by: new Types.ObjectId(actor.userId) } } },
        { new: true },
    );
    if (!done) throw new AppError('Le profil vient d’être modifié. Rechargez-le avant de décider.', 409, true, 'STALE');
    await audit({ actor, action: decision === 'approve' ? 'candidate.profile_approved' : 'candidate.changes_requested', editionId: e._id, candidateId: c._id, reason });
    if (decision === 'approve') {
        await notifyCandidate(done, 'impact-profile-approved', 'SBC Impact Challenge : candidature validée',
            'Ta candidature au SBC Impact Challenge a été validée par l’équipe SBC.');
    } else {
        await notifyCandidate(done, 'impact-profile-changes', 'SBC Impact Challenge : ton profil est à compléter',
            `L’équipe SBC te demande de modifier ton profil candidat : ${reason}`);
    }
    return presentCandidate(done, e);
};

export const adminEditProfile = async (actor: Actor, id: string, body: Record<string, any>) => {
    const { c, e } = await loadForAdmin(id);
    const reason = reasonOf(body);
    const before = c.profile;
    const profile = parseProfile(body.profile ?? {}, e.settings, c.profile);
    expectSameProfile(c, body);
    const done = await ImpactCandidate.findOneAndUpdate(
        { _id: c._id, profileUpdatedAt: c.profileUpdatedAt },
        { $set: { profile, profileUpdatedAt: new Date() } },
        { new: true },
    );
    if (!done) throw new AppError('Le profil vient d’être modifié. Rechargez-le.', 409, true, 'STALE');
    invalidateBoard();
    await audit({ actor, action: 'candidate.profile_edited_by_admin', editionId: e._id, candidateId: c._id, before, after: profile, reason });
    return presentCandidate(done, e);
};

const SUSPENDABLE = [
    CandidateStatus.QUALIFYING, CandidateStatus.WAITLIST, CandidateStatus.OFFICIAL,
    CandidateStatus.STAGE_2, CandidateStatus.STAGE_3, CandidateStatus.FINALIST,
];

export const suspend = async (actor: Actor, id: string, body: Record<string, any>) => {
    const { c, e } = await loadForAdmin(id);
    const reason = reasonOf(body, 10);
    const done = await transitionCandidate(c._id, SUSPENDABLE, CandidateStatus.SUSPENDED, { by: actor.userId, reason, set: { suspendedFrom: c.status } });
    if (!done) throw new AppError('Ce candidat ne peut pas être suspendu dans son état actuel.', 409, true, 'BAD_STATUS');
    invalidateBoard();
    await audit({ actor, action: 'candidate.suspended', editionId: e._id, candidateId: c._id, before: { status: c.status }, reason });
    await notifyCandidate(done, 'impact-suspended', 'SBC Impact Challenge : candidature suspendue',
        `Ta candidature au SBC Impact Challenge est suspendue : ${reason}. Contacte le support SBC pour en savoir plus.`);
    return presentCandidate(done, e);
};

export const reinstate = async (actor: Actor, id: string, body: Record<string, any>) => {
    const { c, e } = await loadForAdmin(id);
    const reason = reasonOf(body);
    if (c.status !== CandidateStatus.SUSPENDED || !c.suspendedFrom) throw new AppError('Ce candidat n’est pas suspendu.', 409, true, 'BAD_STATUS');
    const done = await transitionCandidate(c._id, [CandidateStatus.SUSPENDED], c.suspendedFrom, { by: actor.userId, reason, unset: ['suspendedFrom'] });
    if (!done) throw new AppError('Le candidat a changé entre-temps. Rechargez la page.', 409, true, 'BAD_STATUS');
    invalidateBoard();
    await audit({ actor, action: 'candidate.reinstated', editionId: e._id, candidateId: c._id, after: { status: c.suspendedFrom }, reason });
    await notifyCandidate(done, 'impact-reinstated', 'SBC Impact Challenge : candidature rétablie',
        'Ta candidature au SBC Impact Challenge est rétablie.');
    return presentCandidate(done, e);
};

/** Final. A seat it frees goes to the waiting list on the next pass of the job. */
export const disqualify = async (actor: Actor, id: string, body: Record<string, any>) => {
    const { c, e } = await loadForAdmin(id);
    const reason = reasonOf(body, 10);
    const from = [...SUSPENDABLE, CandidateStatus.SUSPENDED];
    const done = await transitionCandidate(c._id, from, CandidateStatus.DISQUALIFIED, { by: actor.userId, reason });
    if (!done) throw new AppError('Ce candidat ne peut pas être disqualifié dans son état actuel.', 409, true, 'BAD_STATUS');
    invalidateBoard();
    await audit({ actor, action: 'candidate.disqualified', editionId: e._id, candidateId: c._id, before: { status: c.status, seatNumber: c.seatNumber }, reason });
    await notifyCandidate(done, 'impact-disqualified', 'SBC Impact Challenge : candidature retirée',
        `Ta candidature au SBC Impact Challenge a été retirée par l’équipe SBC : ${reason}.`);
    return presentCandidate(done, e);
};

/** « Ajouter » (spec §15): the administration creates a candidacy for a member, who still needs the invitations. */
export const adminAdd = async (actor: Actor, editionId: string, body: Record<string, any>) => {
    const e = await getEdition(editionId);
    if (e.status !== EditionStatus.QUALIFICATION) throw new AppError('On ne peut ajouter un candidat que pendant la qualification.', 409, true, 'BAD_STATUS');
    const userId = String(body.userId ?? '');
    if (!Types.ObjectId.isValid(userId)) throw new AppError('Choisissez le membre.', 400, true, 'USER_REQUIRED');
    return createCandidacy(e, userId, body, actor);
};

export const editionAudit = async (editionId: string, q: Record<string, any>) => {
    const e = await getEdition(editionId);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 100));
    const filter: Record<string, unknown> = { editionId: e._id };
    // Cursor = the last entry shown (`before` = its `at`, `beforeId` = its `_id`). The
    // job writes many lines in the same millisecond, so time alone would skip some.
    if (q.before) {
        const b = new Date(String(q.before));
        if (!Number.isNaN(b.getTime())) {
            filter.$or = q.beforeId && Types.ObjectId.isValid(String(q.beforeId))
                ? [{ at: { $lt: b } }, { at: b, _id: { $lt: new Types.ObjectId(String(q.beforeId)) } }]
                : [{ at: { $lt: b } }];
        }
    }
    return withActorNames(await ImpactAudit.find(filter).sort({ at: -1, _id: -1 }).limit(limit).lean());
};

/** Recount everyone now (administration button; the job does it every 30 min). */
export const recountEdition = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    if (e.status !== EditionStatus.QUALIFICATION && e.status !== EditionStatus.QUALIFICATION_CLOSED) {
        throw new AppError('Le compteur ne tourne que pendant la qualification.', 409, true, 'BAD_STATUS');
    }
    let updated: number;
    try {
        updated = await refreshInvitations(e);
    } catch (err) {
        throw new AppError(`Recomptage impossible : ${(err as Error).message}`, 503, true, 'COUNTER_UNAVAILABLE');
    }
    await audit({ actor, action: 'edition.recounted', editionId: e._id, after: { updated } });
    return { updated };
};

/**
 * The official candidates as CSV, for SBC's social media team (flyers and
 * Facebook posts of week 1, spec §5): one line per published candidate.
 */
export const exportCandidatesCsv = async (editionId: string) => {
    const e = await getEdition(editionId);
    const rows = await ImpactCandidate.find({ editionId: e._id, seatNumber: { $exists: true }, status: { $nin: [CandidateStatus.DISQUALIFIED, CandidateStatus.WITHDRAWN] } })
        .sort({ seatNumber: 1 }).lean();
    const cell = (v: unknown) => {
        const s = String(v ?? '').replace(/\r?\n/g, ' ');
        // Quote everything; neutralise spreadsheet formulas.
        return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const head = ['Place', 'Nom', 'Identifiant SBC', 'Ville', 'Pays', 'Activité', 'Catégorie', 'Projet', 'Description du projet', 'Photo', 'Statut', 'Votes gratuits', 'Votes payants'];
    const lines = rows.map((c) => [
        c.seatNumber, c.profile.name, c.sbcId, c.profile.city, c.profile.country, c.profile.activity, c.profile.category,
        c.profile.projectName, c.profile.projectDescription, `/api/settings/files/${encodeURIComponent(c.profile.photoFileId)}`,
        STATUS_LABEL_FR[c.status], c.votes?.free ?? 0, c.votes?.paid ?? 0,
    ].map(cell).join(','));
    return '\uFEFF' + [head.map(cell).join(','), ...lines].join('\r\n');
};
