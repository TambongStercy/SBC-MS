import { Types } from 'mongoose';
import Event, { EventStatus } from '../../../database/models/event.model';
import { AppError } from '../../../utils/errors';
import { AnimCandidate, AnimChallenge, AnimJuryAssignment, IAnimCandidate, IAnimChallenge } from '../models/challenge.model';
import { AnimCtx, CandidateStatus, ChallengeStatus, ParticipationMode, Perm, RuleTrigger, TeamRole, statusIndex } from '../types';
import { Actor, audit } from '../lib/audit';
import { asSentence } from '../lib/rules';
import { holdsValidTicket } from './eligibility.service';
import { markBoardDirty } from './board.service';
import { enqueue } from './outbox.service';

const LIVE = [CandidateStatus.PENDING, CandidateStatus.APPROVED];

const profileFields = (body: Record<string, any>, challenge: IAnimChallenge) => {
    const displayName = String(body.displayName ?? '').trim().slice(0, 80);
    const category = body.category ? String(body.category).trim().slice(0, 60) : undefined;
    if (category && challenge.participation.categories.length && !challenge.participation.categories.includes(category)) {
        throw new AppError('Catégorie inconnue pour ce défi.', 400);
    }
    if (body.videoFileId && !challenge.participation.videoAllowed) throw new AppError('Ce défi n’accepte pas de vidéo.', 400);
    return {
        displayName,
        photoFileId: body.photoFileId ? String(body.photoFileId).slice(0, 200) : undefined,
        videoFileId: body.videoFileId ? String(body.videoFileId).slice(0, 200) : undefined,
        description: body.description ? String(body.description).trim().slice(0, 2000) : undefined,
        category,
    };
};

/** Can this user take part (§12)? Throws with the reason when not. */
export const assertCanParticipate = async (challenge: IAnimChallenge, userId: string) => {
    const p = challenge.participation;
    if (p.mode === ParticipationMode.TICKET_HOLDERS && !(await holdsValidTicket(userId, challenge.eventId))) {
        throw new AppError('Ce défi est réservé aux détenteurs d’un billet valide.', 403, true, 'TICKET_REQUIRED');
    }
    if (p.mode === ParticipationMode.TICKET_TYPES && !(await holdsValidTicket(userId, challenge.eventId, p.ticketTypeIds))) {
        throw new AppError('Ce défi est réservé à certains types de billets.', 403, true, 'TICKET_TYPE_REQUIRED');
    }
    if (await AnimJuryAssignment.exists({ challengeId: challenge._id, userId, status: 'ACTIVE' })) {
        throw new AppError('Un membre du jury ne peut pas concourir dans ce défi.', 403, true, 'JUROR_CANNOT_COMPETE');
    }
};

/**
 * "Participer" (§13). The number and the capacity check are one atomic $inc
 * on the challenge, so 200 simultaneous sign-ups for 50 places give exactly
 * 50 candidates, numbered without collision.
 *
 * A withdrawn or rejected user who signs up again reuses their document and
 * keeps their number (the {challengeId, userId} index forbids a second one).
 */
export const register = async (userId: string, challengeId: string, body: Record<string, any>, actorIp?: string) => {
    if (!Types.ObjectId.isValid(challengeId)) throw new AppError('Défi introuvable.', 404);
    const challenge = await AnimChallenge.findById(challengeId);
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    const now = Date.now();
    const s = challenge.schedule;
    if (challenge.status !== ChallengeStatus.REGISTRATION_OPEN
        || (s.registrationOpensAt && new Date(s.registrationOpensAt).getTime() > now)
        || (s.registrationClosesAt && new Date(s.registrationClosesAt).getTime() <= now)) {
        throw new AppError('Les inscriptions ne sont pas ouvertes.', 409, true, 'REGISTRATION_CLOSED');
    }
    if (challenge.suspendedAt) throw new AppError('Ce défi est suspendu.', 409, true, 'SUSPENDED');
    const event = await Event.findById(challenge.eventId).select('status').lean();
    if (event?.status !== EventStatus.PUBLISHED) throw new AppError('Cet événement n’est pas ouvert.', 409, true, 'EVENT_CLOSED');
    await assertCanParticipate(challenge, userId);

    const profile = profileFields(body, challenge);
    if (!profile.displayName) throw new AppError('Indiquez votre nom ou pseudonyme.', 400);
    if (challenge.participation.photoRequired && !profile.photoFileId) throw new AppError('Une photo est obligatoire pour ce défi.', 400, true, 'PHOTO_REQUIRED');

    const existing = await AnimCandidate.findOne({ challengeId: challenge._id, userId });
    if (existing && LIVE.includes(existing.status)) throw new AppError('Vous êtes déjà inscrit à ce défi.', 409, true, 'ALREADY_REGISTERED');
    if (existing?.status === CandidateStatus.DISQUALIFIED) throw new AppError('Vous avez été disqualifié de ce défi.', 403, true, 'DISQUALIFIED');

    // Reserve a place (and a number for a first-time candidate) atomically.
    const claimed = await AnimChallenge.findOneAndUpdate(
        {
            _id: challenge._id,
            status: ChallengeStatus.REGISTRATION_OPEN,
            $expr: { $lt: ['$counters.candidates', '$participation.maxCandidates'] },
        },
        { $inc: { 'counters.candidates': 1, ...(existing ? {} : { candidateSeq: 1 }) } },
        { new: true },
    );
    if (!claimed) throw new AppError('Toutes les places de ce défi sont prises.', 409, true, 'CHALLENGE_FULL');

    const status = challenge.participation.requiresApproval ? CandidateStatus.PENDING : CandidateStatus.APPROVED;
    let candidate: IAnimCandidate;
    try {
        if (existing) {
            const reopened = await AnimCandidate.findOneAndUpdate(
                { _id: existing._id, status: { $in: [CandidateStatus.WITHDRAWN, CandidateStatus.REJECTED] } },
                {
                    $set: { ...profile, status },
                    $push: { statusHistory: { from: existing.status, to: status, at: new Date(), by: new Types.ObjectId(userId), reason: 'réinscription' } },
                },
                { new: true },
            );
            if (!reopened) throw new AppError('Vous êtes déjà inscrit à ce défi.', 409, true, 'ALREADY_REGISTERED');
            candidate = reopened;
        } else {
            candidate = await AnimCandidate.create({
                organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id,
                userId, number: claimed.candidateSeq, ...profile, status,
                statusHistory: [{ from: 'NONE', to: status, at: new Date(), by: new Types.ObjectId(userId) }],
            });
        }
    } catch (err: any) {
        // Give the place back: a double click lost the race on the unique index.
        await AnimChallenge.updateOne({ _id: challenge._id }, { $inc: { 'counters.candidates': -1 } });
        if (err?.code === 11000) throw new AppError('Vous êtes déjà inscrit à ce défi.', 409, true, 'ALREADY_REGISTERED');
        throw err;
    }
    if (status === CandidateStatus.APPROVED) {
        await AnimChallenge.updateOne({ _id: challenge._id }, { $inc: { 'counters.approved': 1 } });
        await markBoardDirty(challenge._id);
    }

    await audit({
        actor: { actorUserId: userId, role: TeamRole.PARTICIPANT, ip: actorIp }, action: 'candidate.register',
        targetType: 'candidate', targetId: candidate._id, organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id,
        after: { number: candidate.number, status },
    });
    await enqueue({
        dedupeKey: `anim-candidate-registered:${candidate._id}:${candidate.statusHistory.length}`,
        kind: 'anim-candidate-registered', userId, eventId: challenge.eventId,
        subject: `🎤 Inscription confirmée — ${challenge.name}`,
        body: status === CandidateStatus.PENDING
            ? `Vous êtes le candidat n°${candidate.number}. Votre candidature sera validée par l’organisateur.`
            : `Vous êtes le candidat n°${candidate.number}. Partagez votre page pour récolter des votes !`,
        data: { challengeId: String(challenge._id), number: candidate.number },
    });
    const { onTrigger } = await import('./reward.service');
    await onTrigger({ trigger: RuleTrigger.CHALLENGE_REGISTERED, eventId: String(challenge.eventId), challengeId: String(challenge._id), userId, subjectKey: `cand:${candidate._id}` });
    if (status === CandidateStatus.APPROVED) {
        await onTrigger({ trigger: RuleTrigger.CANDIDATE_APPROVED, eventId: String(challenge.eventId), challengeId: String(challenge._id), userId, subjectKey: `cand:${candidate._id}` });
    }
    return candidate;
};

/** A candidate edits their own profile while it is still pending review. */
export const updateOwnProfile = async (userId: string, candidateId: string, body: Record<string, any>) => {
    const candidate = await AnimCandidate.findOne({ _id: candidateId, userId });
    if (!candidate) throw new AppError('Candidature introuvable.', 404);
    if (candidate.status !== CandidateStatus.PENDING) throw new AppError('Une candidature validée ne peut plus être modifiée.', 409);
    const challenge = await AnimChallenge.findById(candidate.challengeId);
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    const profile = profileFields({ ...candidate.toObject(), ...body }, challenge);
    if (!profile.displayName) throw new AppError('Indiquez votre nom ou pseudonyme.', 400);
    Object.assign(candidate, profile);
    await candidate.save();
    return candidate;
};

/** Withdrawal frees the place; votes already cast stay in the ledger but stop counting on the board. */
export const withdraw = async (userId: string, candidateId: string) => {
    const candidate = await AnimCandidate.findOne({ _id: candidateId, userId });
    if (!candidate) throw new AppError('Candidature introuvable.', 404);
    const challenge = await AnimChallenge.findById(candidate.challengeId);
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    if (statusIndex(challenge.status) >= statusIndex(ChallengeStatus.VOTING_CLOSED) || challenge.status === ChallengeStatus.CANCELLED) {
        throw new AppError('Il est trop tard pour se retirer.', 409);
    }
    return setCandidateStatus({ actorUserId: userId, role: TeamRole.PARTICIPANT }, candidate, CandidateStatus.WITHDRAWN, 'retrait volontaire');
};

const ALLOWED: Record<CandidateStatus, CandidateStatus[]> = {
    [CandidateStatus.PENDING]: [CandidateStatus.APPROVED, CandidateStatus.REJECTED, CandidateStatus.WITHDRAWN, CandidateStatus.DISQUALIFIED],
    [CandidateStatus.APPROVED]: [CandidateStatus.DISQUALIFIED, CandidateStatus.WITHDRAWN],
    [CandidateStatus.REJECTED]: [CandidateStatus.APPROVED],
    [CandidateStatus.WITHDRAWN]: [],
    [CandidateStatus.DISQUALIFIED]: [],
};

/** Every status change is atomic, counted and logged (§14: disqualifications must be). */
const setCandidateStatus = async (actor: Actor, candidate: IAnimCandidate, to: CandidateStatus, reason?: string) => {
    const from = candidate.status;
    if (!ALLOWED[from].includes(to)) throw new AppError(`Passage de ${from} à ${to} impossible.`, 409, true, 'BAD_TRANSITION');
    if ((to === CandidateStatus.DISQUALIFIED || to === CandidateStatus.REJECTED) && !reason?.trim()) {
        throw new AppError('Indiquez le motif.', 400, true, 'REASON_REQUIRED');
    }
    const updated = await AnimCandidate.findOneAndUpdate(
        { _id: candidate._id, status: from },
        { $set: { status: to }, $push: { statusHistory: { from, to, at: new Date(), by: actor.actorUserId ? new Types.ObjectId(actor.actorUserId) : undefined, reason } } },
        { new: true },
    );
    if (!updated) throw new AppError('La candidature a changé entre-temps.', 409, true, 'CONCURRENT_CHANGE');

    const live = (s: CandidateStatus) => LIVE.includes(s);
    const inc: Record<string, number> = {};
    if (live(from) && !live(to)) inc['counters.candidates'] = -1;
    if (!live(from) && live(to)) inc['counters.candidates'] = 1;
    if (from === CandidateStatus.APPROVED) inc['counters.approved'] = -1;
    if (to === CandidateStatus.APPROVED) inc['counters.approved'] = (inc['counters.approved'] ?? 0) + 1;
    if (Object.keys(inc).length) await AnimChallenge.updateOne({ _id: candidate.challengeId }, { $inc: inc });

    await audit({
        actor, action: `candidate.${to.toLowerCase()}`, targetType: 'candidate', targetId: candidate._id,
        organizerId: candidate.organizerId, eventId: candidate.eventId, challengeId: candidate.challengeId,
        before: { status: from }, after: { status: to }, reason,
    });
    await markBoardDirty(candidate.challengeId);

    if (from === CandidateStatus.APPROVED && (to === CandidateStatus.WITHDRAWN || to === CandidateStatus.DISQUALIFIED) && updated.paidVotes > 0) {
        const { refundCandidateTransactions } = await import('./paid-vote.service');
        const why = to === CandidateStatus.WITHDRAWN ? `${updated.displayName} s’est retiré(e) du défi` : `${updated.displayName} a été disqualifié(e)`;
        await refundCandidateTransactions(actor, candidate._id, why);
    }

    const challenge = await AnimChallenge.findById(candidate.challengeId).select('name eventId').lean();
    const messages: Partial<Record<CandidateStatus, [string, string]>> = {
        [CandidateStatus.APPROVED]: ['✅ Candidature validée', `Votre candidature n°${updated.number} à « ${challenge?.name} » est validée.`],
        [CandidateStatus.REJECTED]: ['Candidature non retenue', `Votre candidature à « ${challenge?.name} » n’a pas été retenue. ${reason ? `Motif : ${asSentence(reason)}` : ''}`.trim()],
        [CandidateStatus.DISQUALIFIED]: ['⛔ Disqualification', `Vous avez été disqualifié de « ${challenge?.name} ». Motif : ${asSentence(reason)}`],
    };
    const msg = messages[to];
    if (msg && String(actor.actorUserId) !== String(candidate.userId)) {
        await enqueue({
            dedupeKey: `anim-candidate-${to.toLowerCase()}:${candidate._id}:${updated.statusHistory.length}`,
            kind: `anim-candidate-${to.toLowerCase()}`, userId: candidate.userId, eventId: candidate.eventId,
            subject: msg[0], body: msg[1], data: { challengeId: String(candidate.challengeId), number: updated.number },
        });
    }
    if (to === CandidateStatus.APPROVED) {
        const { onTrigger } = await import('./reward.service');
        await onTrigger({ trigger: RuleTrigger.CANDIDATE_APPROVED, eventId: String(candidate.eventId), challengeId: String(candidate.challengeId), userId: String(candidate.userId), subjectKey: `cand:${candidate._id}` });
    }
    return updated;
};

/** Organizer moderation (§14). */
export const moderate = async (ctx: AnimCtx, candidateId: string, action: 'approve' | 'reject' | 'disqualify', reason?: string) => {
    if (!Types.ObjectId.isValid(candidateId)) throw new AppError('Candidature introuvable.', 404);
    const candidate = await AnimCandidate.findOne({ _id: candidateId, eventId: ctx.eventId });
    if (!candidate) throw new AppError('Candidature introuvable.', 404);
    const challenge = await AnimChallenge.findById(candidate.challengeId).select('status').lean();
    if (!challenge || [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED, ChallengeStatus.RESULTS_PENDING].includes(challenge.status)) {
        throw new AppError('Ce défi n’accepte plus de modération.', 409);
    }
    const to = { approve: CandidateStatus.APPROVED, reject: CandidateStatus.REJECTED, disqualify: CandidateStatus.DISQUALIFIED }[action];
    // Disqualifying refunds the candidate's paid votes, debiting the organizer: a money decision.
    if (to === CandidateStatus.DISQUALIFIED && candidate.paidVotes > 0 && !ctx.perms.includes(Perm.MONEY)) {
        throw new AppError('Ce candidat a reçu des votes payants : seul l’organisateur ou un gestionnaire peut le disqualifier (les acheteurs seront remboursés).', 403, true, 'FORBIDDEN_ROLE');
    }
    if (to === CandidateStatus.APPROVED && candidate.status === CandidateStatus.REJECTED) {
        // Re-approving a rejected candidacy takes a place again.
        const claimed = await AnimChallenge.findOneAndUpdate(
            { _id: candidate.challengeId, $expr: { $lt: ['$counters.candidates', '$participation.maxCandidates'] } },
            { $inc: { 'counters.candidates': 0 } },
        );
        if (!claimed) throw new AppError('Le défi est complet.', 409, true, 'CHALLENGE_FULL');
    }
    return setCandidateStatus(ctx, candidate, to, reason);
};

/**
 * The organizer seeds a candidate (pre-selected contestants). They must have an
 * SBC account — prizes and notifications go to a person. Approved directly.
 */
export const addCandidateByOrganizer = async (ctx: AnimCtx, challengeId: string, body: Record<string, any>) => {
    const challenge = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    if (statusIndex(challenge.status) >= statusIndex(ChallengeStatus.VOTING_CLOSED) || challenge.status === ChallengeStatus.CANCELLED) {
        throw new AppError('Trop tard pour ajouter un candidat.', 409);
    }
    const userId = String(body.userId ?? '');
    if (!Types.ObjectId.isValid(userId)) throw new AppError('Choisissez le compte SBC du candidat.', 400);
    if (await AnimJuryAssignment.exists({ challengeId: challenge._id, userId, status: 'ACTIVE' })) {
        throw new AppError('Ce membre est juré de ce défi.', 409, true, 'JUROR_CANNOT_COMPETE');
    }
    const profile = profileFields(body, challenge);
    if (!profile.displayName) throw new AppError('Indiquez le nom affiché.', 400);
    if (await AnimCandidate.exists({ challengeId: challenge._id, userId })) throw new AppError('Ce membre est déjà candidat.', 409, true, 'ALREADY_REGISTERED');
    const claimed = await AnimChallenge.findOneAndUpdate(
        { _id: challenge._id, $expr: { $lt: ['$counters.candidates', '$participation.maxCandidates'] } },
        { $inc: { 'counters.candidates': 1, 'counters.approved': 1, candidateSeq: 1 } },
        { new: true },
    );
    if (!claimed) throw new AppError('Le défi est complet.', 409, true, 'CHALLENGE_FULL');
    let candidate: IAnimCandidate;
    try {
        candidate = await AnimCandidate.create({
            organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id,
            userId, number: claimed.candidateSeq, ...profile, status: CandidateStatus.APPROVED, addedByOrganizer: true,
            statusHistory: [{ from: 'NONE', to: CandidateStatus.APPROVED, at: new Date(), by: new Types.ObjectId(ctx.actorUserId), reason: 'ajouté par l’organisateur' }],
        });
    } catch (err: any) {
        await AnimChallenge.updateOne({ _id: challenge._id }, { $inc: { 'counters.candidates': -1, 'counters.approved': -1 } });
        if (err?.code === 11000) throw new AppError('Ce membre est déjà candidat.', 409, true, 'ALREADY_REGISTERED');
        throw err;
    }
    await audit({ actor: ctx, action: 'candidate.add', targetType: 'candidate', targetId: candidate._id, challengeId: challenge._id, after: { number: candidate.number, userId } });
    await markBoardDirty(challenge._id);
    return candidate;
};

export const listCandidates = async (filter: {
    challengeId: string; eventId?: string; statuses?: CandidateStatus[]; q?: string; page?: number; limit?: number; sort?: 'number' | 'votes' | 'recent';
}) => {
    const query: Record<string, unknown> = { challengeId: new Types.ObjectId(filter.challengeId) };
    if (filter.eventId) query.eventId = new Types.ObjectId(filter.eventId);
    if (filter.statuses?.length) query.status = { $in: filter.statuses };
    const q = filter.q?.trim();
    if (q) {
        const n = Number(q.replace(/^n°?\s*/i, ''));
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [{ displayName: { $regex: escaped, $options: 'i' } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
    }
    const limit = Math.min(Math.max(filter.limit ?? 24, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const sort: Record<string, 1 | -1> = filter.sort === 'votes' ? { totalVotes: -1, number: 1 } : filter.sort === 'recent' ? { createdAt: -1 } : { number: 1 };
    const [items, total] = await Promise.all([
        AnimCandidate.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        AnimCandidate.countDocuments(query),
    ]);
    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
};
