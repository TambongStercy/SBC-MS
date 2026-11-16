import { createHash, randomBytes } from 'crypto';
import { Types } from 'mongoose';
import Event from '../../../database/models/event.model';
import Organizer from '../../../database/models/organizer.model';
import { AppError } from '../../../utils/errors';
import { lookupEventMember, getEventUserDetails } from '../../../services/clients/user.service.client';
import { AnimCandidate, AnimChallenge, AnimJuryAssignment, AnimJuryScore } from '../models/challenge.model';
import { AnimInvite, AnimTeamMember } from '../models/governance.model';
import { AnimCtx, CandidateStatus, ChallengeStatus, Perm, TeamRole, statusIndex } from '../types';
import { audit } from '../lib/audit';
import { weightedJuryScore } from '../lib/rules';
import { markBoardDirty } from './board.service';
import { enqueue } from './outbox.service';

const INVITE_TTL_MS = 7 * 86_400_000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

const ASSIGNABLE = [TeamRole.MANAGER, TeamRole.MODERATOR, TeamRole.STAFF];

/**
 * Team (§31) and jury (§23) members are SBC accounts: every action and every
 * score must trace to an authenticated person. A contact without an account
 * gets a single-use invitation (token stored hashed, 7 days) that binds to
 * whichever logged-in account accepts it.
 */
const resolveOrInvite = async (ctx: AnimCtx, kind: 'TEAM' | 'JURY', contact: string, extra: { role?: TeamRole; challengeId?: string; allEvents?: boolean }) => {
    const c = String(contact ?? '').trim();
    if (!c) throw new AppError('Indiquez un email ou un numéro de téléphone.', 400);
    const found = await lookupEventMember(c);
    if (found.ambiguous) throw new AppError('Plusieurs comptes correspondent : indiquez le numéro complet avec l’indicatif.', 409, true, 'AMBIGUOUS_CONTACT');
    if (found.found && found.userId) return { userId: found.userId, name: found.name, invite: null as null | { token: string; expiresAt: Date } };
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await AnimInvite.create({
        organizerId: ctx.organizerId, eventId: ctx.eventId, challengeId: extra.challengeId, kind, role: extra.role, allEvents: Boolean(extra.allEvents),
        contact: c, tokenHash: hashToken(token), expiresAt, invitedBy: ctx.actorUserId,
    });
    await audit({ actor: ctx, action: `${kind.toLowerCase()}.invite`, targetType: 'invite', challengeId: extra.challengeId, after: { contact: c.replace(/^(.{3}).*$/, '$1•••'), role: extra.role } });
    return { userId: null, name: undefined, invite: { token, expiresAt } };
};

// ---------- team ----------

export const addTeamMember = async (ctx: AnimCtx, body: { contact?: string; userId?: string; role: TeamRole; allEvents?: boolean }) => {
    if (!ASSIGNABLE.includes(body.role)) throw new AppError('Rôle invalide.', 400);
    const scopeEventId = body.allEvents ? null : new Types.ObjectId(ctx.eventId);
    let userId = body.userId && Types.ObjectId.isValid(body.userId) ? body.userId : null;
    let invite: { token: string; expiresAt: Date } | null = null;
    if (!userId) {
        const r = await resolveOrInvite(ctx, 'TEAM', body.contact ?? '', { role: body.role, allEvents: body.allEvents });
        userId = r.userId;
        invite = r.invite;
    }
    if (!userId) return { member: null, invite };
    const owner = await Organizer.findById(ctx.organizerId).select('userId').lean();
    if (owner && String(owner.userId) === userId) throw new AppError('L’organisateur a déjà tous les droits.', 409);
    const member = await AnimTeamMember.findOneAndUpdate(
        { organizerId: ctx.organizerId, eventId: scopeEventId, userId },
        { $set: { role: body.role, status: 'ACTIVE', invitedBy: ctx.actorUserId } },
        { upsert: true, new: true },
    );
    await audit({ actor: ctx, action: 'team.add', targetType: 'team_member', targetId: member._id, after: { userId, role: body.role, allEvents: Boolean(body.allEvents) } });
    const event = await Event.findById(ctx.eventId).select('title').lean();
    await enqueue({
        dedupeKey: `anim-team-invite:${member._id}:${body.role}:${Date.now()}`, kind: 'anim-team-invite', userId, eventId: ctx.eventId,
        subject: `👥 Vous rejoignez l’équipe — ${event?.title ?? 'SBC Event'}`,
        body: `Vous avez été ajouté comme ${ROLE_NAME[body.role as keyof typeof ROLE_NAME] ?? 'membre'} de l’animation de « ${event?.title ?? ''} ».`,
    });
    return { member, invite: null };
};

export const revokeInvite = async (ctx: AnimCtx, inviteId: string) => {
    const invite = await AnimInvite.findOneAndUpdate({ _id: inviteId, eventId: ctx.eventId, status: 'PENDING' }, { $set: { status: 'REVOKED' } }, { new: true });
    if (!invite) throw new AppError('Invitation introuvable ou déjà utilisée.', 404);
    await audit({ actor: ctx, action: `${invite.kind.toLowerCase()}.invite_revoked`, targetType: 'invite', targetId: invite._id, challengeId: invite.challengeId });
    return invite;
};

export const revokeTeamMember = async (ctx: AnimCtx, memberId: string) => {
    const member = await AnimTeamMember.findOneAndUpdate(
        { _id: memberId, organizerId: ctx.organizerId, $or: [{ eventId: ctx.eventId }, { eventId: null }] },
        { $set: { status: 'REVOKED' } },
        { new: true },
    );
    if (!member) throw new AppError('Membre introuvable.', 404);
    await audit({ actor: ctx, action: 'team.revoke', targetType: 'team_member', targetId: member._id, after: { userId: String(member.userId) } });
    return member;
};

const withNames = async <T extends { userId: Types.ObjectId | string }>(rows: T[]) => {
    const ids = [...new Set(rows.map((r) => String(r.userId)))];
    const users = ids.length ? await getEventUserDetails(ids).catch(() => []) : [];
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return rows.map((r) => ({ ...r, name: byId.get(String(r.userId))?.name ?? 'Membre SBC', avatar: byId.get(String(r.userId))?.avatar }));
};

const ROLE_NAME = { [TeamRole.MANAGER]: 'gestionnaire', [TeamRole.MODERATOR]: 'modérateur', [TeamRole.STAFF]: 'membre du staff' } as const;

export const listTeam = async (ctx: AnimCtx) => {
    // Pending invites carry the invitee's email or phone: only for those who manage the team.
    const [members, invites] = await Promise.all([
        AnimTeamMember.find({ organizerId: ctx.organizerId, status: 'ACTIVE', $or: [{ eventId: ctx.eventId }, { eventId: null }] }).lean(),
        ctx.perms.includes(Perm.TEAM)
            ? AnimInvite.find({ eventId: ctx.eventId, status: 'PENDING', expiresAt: { $gt: new Date() } }).select('-tokenHash').lean()
            : Promise.resolve([]),
    ]);
    return { members: await withNames(members), invites };
};

/** Events where this user has a role, for "Mes événements en équipe". */
export const myTeams = async (userId: string): Promise<{ events: Record<string, unknown>[]; juryChallenges: number }> => {
    const [members, juries] = await Promise.all([
        AnimTeamMember.find({ userId, status: 'ACTIVE' }).lean(),
        AnimJuryAssignment.find({ userId, status: 'ACTIVE' }).lean(),
    ]);
    const eventIds = [...new Set(members.filter((m) => m.eventId).map((m) => String(m.eventId)))];
    const orgWide = members.filter((m) => !m.eventId).map((m) => m.organizerId);
    const events = await Event.find({ $or: [{ _id: { $in: eventIds } }, { organizerId: { $in: orgWide } }] })
        .select('title slug startsAt status organizerId').sort({ startsAt: -1 }).limit(100).lean();
    return {
        events: events.map((e) => ({
            ...e,
            role: members.find((m) => String(m.eventId) === String(e._id))?.role ?? members.find((m) => !m.eventId && String(m.organizerId) === String(e.organizerId))?.role,
        })),
        juryChallenges: juries.length,
    };
};

// ---------- jury ----------

export const addJuror = async (ctx: AnimCtx, challengeId: string, body: { contact?: string; userId?: string }) => {
    const challenge = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    if (statusIndex(challenge.status) >= statusIndex(ChallengeStatus.RESULTS_PENDING) || challenge.status === ChallengeStatus.CANCELLED) {
        throw new AppError('Trop tard pour modifier le jury.', 409);
    }
    let userId = body.userId && Types.ObjectId.isValid(body.userId) ? body.userId : null;
    let invite: { token: string; expiresAt: Date } | null = null;
    if (!userId) {
        const r = await resolveOrInvite(ctx, 'JURY', body.contact ?? '', { challengeId });
        userId = r.userId;
        invite = r.invite;
    }
    if (!userId) return { juror: null, invite };
    return { juror: await assignJuror(ctx, challenge._id, userId), invite: null };
};

const assignJuror = async (ctx: Pick<AnimCtx, 'organizerId' | 'eventId' | 'actorUserId' | 'role'>, challengeId: Types.ObjectId, userId: string) => {
    if (await AnimCandidate.exists({ challengeId, userId, status: { $in: [CandidateStatus.PENDING, CandidateStatus.APPROVED] } })) {
        throw new AppError('Ce membre est candidat : il ne peut pas être juré du même défi.', 409, true, 'CANDIDATE_CANNOT_JUDGE');
    }
    const juror = await AnimJuryAssignment.findOneAndUpdate(
        { challengeId, userId },
        { $set: { status: 'ACTIVE', invitedBy: ctx.actorUserId }, $setOnInsert: { organizerId: ctx.organizerId, eventId: ctx.eventId } },
        { upsert: true, new: true },
    );
    await audit({ actor: ctx as AnimCtx, action: 'jury.add', targetType: 'jury_assignment', targetId: juror._id, challengeId, after: { userId } });
    const challenge = await AnimChallenge.findById(challengeId).select('name eventId').lean();
    await enqueue({
        dedupeKey: `anim-jury-invite:${juror._id}`, kind: 'anim-jury-invite', userId, eventId: challenge?.eventId,
        subject: `⚖️ Vous êtes juré — ${challenge?.name}`,
        body: `Vous êtes membre du jury de « ${challenge?.name} ». Retrouvez les candidats à noter dans « Jury ».`,
        data: { challengeId: String(challengeId) },
    });
    return juror;
};

/** A revoked juror's sheets stop counting; the candidates' jury scores are recomputed. */
export const removeJuror = async (ctx: AnimCtx, challengeId: string, userId: string) => {
    const juror = await AnimJuryAssignment.findOneAndUpdate({ challengeId, userId, eventId: ctx.eventId }, { $set: { status: 'REVOKED' } }, { new: true });
    if (!juror) throw new AppError('Juré introuvable.', 404);
    const sheets = await AnimJuryScore.find({ challengeId, jurorUserId: userId, status: 'SUBMITTED' }).select('candidateId').lean();
    await AnimJuryScore.updateMany({ challengeId, jurorUserId: userId }, { $set: { status: 'DRAFT' } });
    for (const s of sheets) await recomputeJuryScore(s.candidateId);
    await audit({ actor: ctx, action: 'jury.remove', targetType: 'jury_assignment', targetId: juror._id, challengeId, after: { userId, sheetsWithdrawn: sheets.length } });
    return juror;
};

export const listJurors = async (ctx: AnimCtx, challengeId: string): Promise<Record<string, unknown>[]> => {
    const jurors = await AnimJuryAssignment.find({ challengeId, eventId: ctx.eventId, status: 'ACTIVE' }).lean();
    const counts = await AnimJuryScore.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { challengeId: new Types.ObjectId(challengeId), status: 'SUBMITTED' } },
        { $group: { _id: '$jurorUserId', n: { $sum: 1 } } },
    ]);
    const byJuror = new Map(counts.map((c) => [String(c._id), c.n]));
    return (await withNames(jurors)).map((j) => ({ ...j, submitted: byJuror.get(String(j.userId)) ?? 0 }));
};

/** Accepts a team or jury invitation for the logged-in account. */
export const acceptInvite = async (userId: string, token: string) => {
    const invite = await AnimInvite.findOneAndUpdate(
        { tokenHash: hashToken(String(token ?? '')), status: 'PENDING', expiresAt: { $gt: new Date() } },
        { $set: { status: 'ACCEPTED', acceptedBy: new Types.ObjectId(userId) } },
        { new: true },
    );
    if (!invite) throw new AppError('Invitation invalide ou expirée.', 404);
    const ctx = { organizerId: String(invite.organizerId), eventId: String(invite.eventId), actorUserId: String(invite.invitedBy), role: TeamRole.OWNER, perms: [] } as AnimCtx;
    if (invite.kind === 'JURY' && invite.challengeId) {
        await assignJuror(ctx, invite.challengeId, userId);
        return { kind: 'JURY', challengeId: String(invite.challengeId), eventId: String(invite.eventId) };
    }
    await AnimTeamMember.findOneAndUpdate(
        { organizerId: invite.organizerId, eventId: invite.allEvents ? null : invite.eventId, userId },
        { $set: { role: invite.role, status: 'ACTIVE', invitedBy: invite.invitedBy } },
        { upsert: true, new: true },
    );
    await audit({ actor: { actorUserId: userId, role: TeamRole.PARTICIPANT }, action: 'team.invite_accepted', targetType: 'invite', targetId: invite._id, eventId: invite.eventId, organizerId: invite.organizerId, after: { role: invite.role } });
    return { kind: 'TEAM', eventId: String(invite.eventId), role: invite.role };
};

// ---------- scoring by jurors ----------

export const myJuryAssignments = async (userId: string): Promise<Record<string, unknown>[]> => {
    const assignments = await AnimJuryAssignment.find({ userId, status: 'ACTIVE' }).lean();
    const challenges = await AnimChallenge.find({ _id: { $in: assignments.map((a) => a.challengeId) } })
        .select('name slug status eventId scoring.criteria schedule counters.approved').lean();
    const events = await Event.find({ _id: { $in: challenges.map((c) => c.eventId) } }).select('title slug').lean();
    const done = await AnimJuryScore.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { jurorUserId: new Types.ObjectId(userId), status: 'SUBMITTED' } },
        { $group: { _id: '$challengeId', n: { $sum: 1 } } },
    ]);
    const doneBy = new Map(done.map((d) => [String(d._id), d.n]));
    return challenges.map((c) => ({ ...c, event: events.find((e) => String(e._id) === String(c.eventId)), submitted: doneBy.get(String(c._id)) ?? 0 }));
};

const assertJuror = async (userId: string, challengeId: string) => {
    if (!Types.ObjectId.isValid(challengeId)) throw new AppError('Défi introuvable.', 404);
    const a = await AnimJuryAssignment.exists({ challengeId, userId, status: 'ACTIVE' });
    if (!a) throw new AppError('Vous n’êtes pas juré de ce défi.', 403, true, 'NOT_JUROR');
    const challenge = await AnimChallenge.findById(challengeId);
    if (!challenge) throw new AppError('Défi introuvable.', 404);
    return challenge;
};

/** The candidates to score, with this juror's own sheet only — scoring is blind. */
export const jurorBoard = async (userId: string, challengeId: string): Promise<{ challenge: Record<string, unknown>; candidates: Record<string, unknown>[] }> => {
    const challenge = await assertJuror(userId, challengeId);
    const [candidates, sheets] = await Promise.all([
        AnimCandidate.find({ challengeId, status: CandidateStatus.APPROVED }).select('number displayName photoFileId videoFileId description category').sort({ number: 1 }).lean(),
        AnimJuryScore.find({ challengeId, jurorUserId: userId }).lean(),
    ]);
    const byCand = new Map(sheets.map((s) => [String(s.candidateId), s]));
    return {
        challenge: { _id: challenge._id, name: challenge.name, status: challenge.status, criteria: challenge.scoring.criteria },
        candidates: candidates.map((c) => ({ ...c, sheet: byCand.get(String(c._id)) ?? null })),
    };
};

const recomputeJuryScore = async (candidateId: Types.ObjectId | string) => {
    const agg = await AnimJuryScore.aggregate<{ avg: number; n: number }>([
        { $match: { candidateId: new Types.ObjectId(String(candidateId)), status: 'SUBMITTED' } },
        { $group: { _id: null, avg: { $avg: '$weightedScore' }, n: { $sum: 1 } } },
    ]);
    const c = await AnimCandidate.findByIdAndUpdate(candidateId, { $set: { juryScore: Math.round((agg[0]?.avg ?? 0) * 100) / 100, juryCount: agg[0]?.n ?? 0 } }, { new: true });
    if (c) await markBoardDirty(c.challengeId);
};

/** Saves (and optionally submits) a juror's sheet. Submitted sheets are final. */
export const saveScore = async (userId: string, challengeId: string, candidateId: string, body: { scores?: { key: string; value: number }[]; comment?: string; submit?: boolean }) => {
    const challenge = await assertJuror(userId, challengeId);
    if (![ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN, ChallengeStatus.VOTING_CLOSED].includes(challenge.status)) {
        throw new AppError('La notation n’est pas ouverte.', 409, true, 'SCORING_CLOSED');
    }
    const candidate = await AnimCandidate.findOne({ _id: candidateId, challengeId, status: CandidateStatus.APPROVED }).select('_id').lean();
    if (!candidate) throw new AppError('Candidat introuvable.', 404);
    const criteria = challenge.scoring.criteria;
    const scores = (body.scores ?? []).filter((s) => criteria.some((c) => c.key === s.key)).map((s) => {
        const c = criteria.find((x) => x.key === s.key)!;
        const v = Number(s.value);
        if (!Number.isFinite(v) || v < 0 || v > c.maxScore) throw new AppError(`« ${c.label} » : note entre 0 et ${c.maxScore}.`, 400);
        return { key: s.key, value: v };
    });
    if (body.submit && scores.length !== criteria.length) throw new AppError('Notez chaque critère avant de valider.', 400, true, 'INCOMPLETE_SHEET');
    const existing = await AnimJuryScore.findOne({ challengeId, candidateId, jurorUserId: userId }).lean();
    if (existing?.status === 'SUBMITTED') throw new AppError('Note déjà validée.', 409, true, 'ALREADY_SUBMITTED');
    const sheet = await AnimJuryScore.findOneAndUpdate(
        { challengeId, candidateId, jurorUserId: userId, status: { $ne: 'SUBMITTED' } },
        {
            $set: {
                scores, comment: body.comment ? String(body.comment).slice(0, 1000) : undefined,
                weightedScore: weightedJuryScore(criteria, scores),
                ...(body.submit ? { status: 'SUBMITTED', submittedAt: new Date() } : {}),
            },
            $setOnInsert: { organizerId: challenge.organizerId, eventId: challenge.eventId },
        },
        { upsert: true, new: true },
    );
    if (body.submit) {
        await recomputeJuryScore(candidateId);
        await audit({ actor: { actorUserId: userId, role: TeamRole.JURY }, action: 'jury.score', targetType: 'jury_score', targetId: sheet._id, organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id, after: { candidateId, weightedScore: sheet.weightedScore } });
    }
    return sheet;
};
