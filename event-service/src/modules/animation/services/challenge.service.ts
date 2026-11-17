import { Types } from 'mongoose';
import slugify from 'slugify';
import Event, { EventStatus } from '../../../database/models/event.model';
import TicketType from '../../../database/models/ticket-type.model';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { AnimCandidate, AnimChallenge, AnimJuryAssignment, IAnimChallenge } from '../models/challenge.model';
import { AnimChangeRequest, IAnimChangeRequest } from '../models/governance.model';
import { AnimReward } from '../models/reward.model';
import { AnimVotePackage } from '../models/vote.model';
import {
    AnimCtx, CandidateStatus, ChallengeStatus, ChangeRequestStatus, FreeVotePeriod, ParticipationMode,
    ScoringMethod, TeamRole, TieRule, VoterScope, VotingMode, allowsFreeVotes, allowsPaidVotes, statusIndex, usesJury,
} from '../types';
import { Actor, SYSTEM_ACTOR, audit, changedPaths } from '../lib/audit';
import { IMMUTABLE_FIELDS, asSentence, canTransition, lockedPathsFor } from '../lib/rules';
import { markBoardDirty, takeSnapshot } from './board.service';
import { enqueue } from './outbox.service';

const log = logger.getLogger('AnimationChallenges');

// ---------- input shaping ----------

/** undefined = not sent (keep); null or '' = clear the value. */
const asDate = (v: unknown): Date | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(v as string);
    if (Number.isNaN(d.getTime())) throw new AppError('Date invalide.', 400);
    return d;
};
const asInt = (v: unknown, min: number, max: number, field: string): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`« ${field} » doit être un entier entre ${min} et ${max}.`, 400);
    return n;
};
const oneOf = <T extends string>(v: unknown, values: T[], field: string): T | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (!values.includes(v as T)) throw new AppError(`Valeur invalide pour « ${field} ».`, 400);
    return v as T;
};
const ids = (v: unknown): Types.ObjectId[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) throw new AppError('Liste d’identifiants attendue.', 400);
    return v.filter((x) => Types.ObjectId.isValid(String(x))).map((x) => new Types.ObjectId(String(x)));
};
const str = (v: unknown, max: number): string | undefined => {
    if (v === undefined || v === null) return undefined;
    return String(v).trim().slice(0, max);
};
const prune = <T extends Record<string, any>>(o: T): Partial<T> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) {
        if (v === undefined) continue;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Types.ObjectId)) {
            const inner = prune(v);
            if (Object.keys(inner).length) out[k] = inner;
        } else out[k] = v;
    }
    return out as Partial<T>;
};

/**
 * The editable shape of a challenge, validated field by field. Unknown keys
 * (status, counters, organizerId…) are dropped — they're never client-settable.
 */
export const shapeChallengeInput = (body: Record<string, any>) => {
    for (const k of Object.keys(body)) {
        if (IMMUTABLE_FIELDS.has(k)) delete body[k];
    }
    const s = body.schedule ?? {};
    const p = body.participation ?? {};
    const v = body.voting ?? {};
    const f = v.free ?? {};
    const sc = body.scoring ?? {};
    return prune({
        name: str(body.name, 140),
        description: str(body.description, 5000),
        imageFileId: str(body.imageFileId, 200),
        rulesText: str(body.rulesText, 10000),
        schedule: body.schedule === undefined ? undefined : {
            registrationOpensAt: asDate(s.registrationOpensAt),
            registrationClosesAt: asDate(s.registrationClosesAt),
            startsAt: asDate(s.startsAt),
            votingOpensAt: asDate(s.votingOpensAt),
            votingClosesAt: asDate(s.votingClosesAt),
            endsAt: asDate(s.endsAt),
            settlementGraceMin: asInt(s.settlementGraceMin, 0, 120, 'délai de grâce') ?? undefined,
        },
        participation: body.participation === undefined ? undefined : {
            mode: oneOf(p.mode, Object.values(ParticipationMode), 'participation'),
            ticketTypeIds: ids(p.ticketTypeIds),
            requiresApproval: p.requiresApproval === undefined ? undefined : Boolean(p.requiresApproval),
            maxCandidates: asInt(p.maxCandidates, 1, 100000, 'nombre maximum de candidats') ?? undefined,
            categories: Array.isArray(p.categories) ? p.categories.map((c: unknown) => String(c).trim().slice(0, 60)).filter(Boolean).slice(0, 30) : undefined,
            photoRequired: p.photoRequired === undefined ? undefined : Boolean(p.photoRequired),
            videoAllowed: p.videoAllowed === undefined ? undefined : Boolean(p.videoAllowed),
        },
        voting: body.voting === undefined ? undefined : {
            mode: oneOf(v.mode, Object.values(VotingMode), 'mode de vote'),
            voterScope: oneOf(v.voterScope, Object.values(VoterScope), 'votants'),
            voterTicketTypeIds: ids(v.voterTicketTypeIds),
            free: v.free === undefined ? undefined : {
                perPeriod: asInt(f.perPeriod, 0, 1000, 'votes gratuits par période') ?? undefined,
                period: oneOf(f.period, Object.values(FreeVotePeriod), 'période'),
                perCandidatePerPeriod: asInt(f.perCandidatePerPeriod, 1, 1000, 'votes par candidat'),
                totalPerChallenge: asInt(f.totalPerChallenge, 1, 100000, 'votes gratuits au total'),
            },
            selfVoteAllowed: v.selfVoteAllowed === undefined ? undefined : Boolean(v.selfVoteAllowed),
            showVoteCounts: v.showVoteCounts === undefined ? undefined : Boolean(v.showVoteCounts),
        },
        scoring: body.scoring === undefined ? undefined : {
            method: oneOf(sc.method, Object.values(ScoringMethod), 'notation'),
            publicWeight: asInt(sc.publicWeight, 0, 100, 'poids du public') ?? undefined,
            juryWeight: asInt(sc.juryWeight, 0, 100, 'poids du jury') ?? undefined,
            criteria: Array.isArray(sc.criteria) ? sc.criteria.slice(0, 20).map((c: any, i: number) => ({
                key: str(c.key, 40) || `c${i + 1}`,
                label: str(c.label, 80) || `Critère ${i + 1}`,
                weight: asInt(c.weight, 1, 100, 'poids du critère')!,
                maxScore: asInt(c.maxScore ?? 10, 1, 100, 'note maximale')!,
            })) : undefined,
        },
        tieRule: oneOf(body.tieRule, Object.values(TieRule), 'règle d’égalité'),
        rankRewards: Array.isArray(body.rankRewards) ? body.rankRewards.slice(0, 50).map((r: any) => ({
            rank: asInt(r.rank, 1, 1000, 'rang')!,
            rewardId: new Types.ObjectId(String(r.rewardId)),
        })) : undefined,
    });
};

/**
 * Coherence of a configuration (§10–§22). Checked when a challenge is
 * programmed, and again on every later edit; drafts may be incomplete.
 */
export const validateChallenge = async (c: IAnimChallenge): Promise<string[]> => {
    const errors: string[] = [];
    const s = c.schedule ?? ({} as IAnimChallenge['schedule']);
    const t = (d?: Date) => (d ? new Date(d).getTime() : undefined);
    const order: [keyof typeof s, keyof typeof s, string][] = [
        ['registrationOpensAt', 'registrationClosesAt', 'L’ouverture des inscriptions doit précéder leur clôture.'],
        ['registrationClosesAt', 'votingOpensAt', 'Les votes ne peuvent ouvrir qu’après la clôture des inscriptions.'],
        ['votingOpensAt', 'votingClosesAt', 'L’ouverture des votes doit précéder leur clôture.'],
        ['startsAt', 'endsAt', 'Le début doit précéder la fin.'],
    ];
    for (const [a, b, msg] of order) {
        const ta = t(s[a] as Date | undefined);
        const tb = t(s[b] as Date | undefined);
        if (ta !== undefined && tb !== undefined && ta >= tb) errors.push(msg);
    }
    if (!c.name?.trim()) errors.push('Le nom est obligatoire.');
    const mode = c.voting.mode;
    if (mode !== VotingMode.NONE && mode !== VotingMode.JURY && !s.votingClosesAt) {
        errors.push('Indiquez la date de clôture des votes.');
    }
    if (allowsFreeVotes(mode) && !(c.voting.free.perPeriod > 0)) {
        errors.push('Le nombre de votes gratuits par période doit être supérieur à 0.');
    }
    if (c.participation.mode === ParticipationMode.TICKET_TYPES && !c.participation.ticketTypeIds.length) {
        errors.push('Choisissez au moins un type de billet pour participer.');
    }
    if (c.voting.voterScope === VoterScope.TICKET_TYPES && !c.voting.voterTicketTypeIds.length) {
        errors.push('Choisissez au moins un type de billet pour voter.');
    }
    const typeIds = [...c.participation.ticketTypeIds, ...c.voting.voterTicketTypeIds];
    if (typeIds.length) {
        const n = await TicketType.countDocuments({ _id: { $in: typeIds }, eventId: c.eventId });
        if (n !== new Set(typeIds.map(String)).size) errors.push('Un type de billet choisi n’appartient pas à cet événement.');
    }
    const sc = c.scoring;
    if (sc.method === ScoringMethod.HYBRID && sc.publicWeight + sc.juryWeight !== 100) {
        errors.push('Les poids public et jury doivent faire 100 %.');
    }
    if ((sc.method === ScoringMethod.HYBRID || sc.method === ScoringMethod.JURY) && !usesJury(mode) && mode !== VotingMode.NONE) {
        errors.push('Une notation par jury demande un mode de vote avec jury.');
    }
    // NONE = an animation without votes: nothing to rank, any method is moot.
    if (sc.method === ScoringMethod.VOTES && mode === VotingMode.JURY) {
        errors.push('Un classement par votes demande un vote du public.');
    }
    if (usesJury(mode)) {
        if (!sc.criteria.length) errors.push('Ajoutez au moins un critère de notation pour le jury.');
        else if (sc.criteria.reduce((a, x) => a + x.weight, 0) !== 100) errors.push('Les poids des critères doivent faire 100 %.');
    }
    if (c.tieRule === TieRule.JURY_DECIDES && !usesJury(mode)) errors.push('« Le jury départage » demande un jury.');
    if (c.rankRewards.length) {
        const n = await AnimReward.countDocuments({ _id: { $in: c.rankRewards.map((r) => r.rewardId) }, eventId: c.eventId });
        if (n !== new Set(c.rankRewards.map((r) => String(r.rewardId))).size) errors.push('Une récompense de classement n’appartient pas à cet événement.');
    }
    return errors;
};

// ---------- queries ----------

export const loadChallenge = async (ctx: Pick<AnimCtx, 'eventId'>, challengeId: string) => {
    if (!Types.ObjectId.isValid(challengeId)) throw new AppError('Défi introuvable.', 404);
    const c = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!c) throw new AppError('Défi introuvable.', 404);
    return c;
};

export const listChallenges = async (ctx: Pick<AnimCtx, 'eventId'>) =>
    AnimChallenge.find({ eventId: ctx.eventId }).sort({ createdAt: -1 }).lean();

// ---------- create / update ----------

const uniqueSlug = async (eventId: string, name: string) => {
    const base = slugify(name, { lower: true, strict: true, trim: true }).slice(0, 80) || 'defi';
    for (let i = 0; i < 20; i++) {
        const slug = i === 0 ? base : `${base}-${i + 1}`;
        if (!(await AnimChallenge.exists({ eventId, slug }))) return slug;
    }
    return `${base}-${Date.now().toString(36)}`;
};

export const createChallenge = async (ctx: AnimCtx, body: Record<string, any>) => {
    const event = await Event.findById(ctx.eventId).select('status').lean();
    if (!event || [EventStatus.CANCELLED, EventStatus.COMPLETED].includes(event.status)) {
        throw new AppError('Impossible d’ajouter un défi à un événement terminé ou annulé.', 409);
    }
    const input = shapeChallengeInput({ ...body });
    if (!input.name) throw new AppError('Le nom du défi est obligatoire.', 400);
    const c = await AnimChallenge.create({
        ...input,
        organizerId: ctx.organizerId,
        eventId: ctx.eventId,
        slug: await uniqueSlug(ctx.eventId, input.name),
        status: ChallengeStatus.DRAFT,
        createdBy: ctx.actorUserId,
    });
    await audit({ actor: ctx, action: 'challenge.create', targetType: 'challenge', targetId: c._id, challengeId: c._id, after: input });
    return c;
};

const applyPatch = (c: IAnimChallenge, patch: Record<string, any>) => {
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Types.ObjectId)) {
            for (const [k2, v2] of Object.entries(v)) {
                if (v2 && typeof v2 === 'object' && !Array.isArray(v2) && !(v2 instanceof Date)) {
                    for (const [k3, v3] of Object.entries(v2)) c.set(`${k}.${k2}.${k3}`, v3 === null ? undefined : v3);
                } else c.set(`${k}.${k2}`, v2 === null ? undefined : v2);
            }
        } else c.set(k, v === null ? undefined : v);
    }
};

/**
 * Edits a challenge. Locked fields (§38) are refused with LOCKED_FIELDS and the
 * list, so the UI can offer a change request instead. Extending the voting
 * deadline is the one self-service exception, and it is audited.
 */
export const updateChallenge = async (ctx: AnimCtx, challengeId: string, body: Record<string, any>) => {
    const c = await loadChallenge(ctx, challengeId);
    const patch = shapeChallengeInput({ ...body });
    const diff = changedPaths(c.toObject(), patch);
    if (!diff.length) return c;

    const locked = lockedPathsFor(c.status, diff.map((d) => d.path));
    if (locked.length) {
        throw new AppError('Ces paramètres sont verrouillés depuis le lancement du défi. Faites une demande de modification.', 409, true, 'LOCKED_FIELDS', { fields: locked });
    }
    const deadline = diff.find((d) => d.path === 'schedule.votingClosesAt');
    if (deadline && statusIndex(c.status) >= statusIndex(ChallengeStatus.ACTIVE)) {
        const from = c.schedule.votingClosesAt ? new Date(c.schedule.votingClosesAt).getTime() : 0;
        const to = new Date(deadline.to as string).getTime();
        if (!(to > from)) throw new AppError('La clôture des votes peut seulement être repoussée.', 409, true, 'LOCKED_FIELDS', { fields: ['schedule.votingClosesAt'] });
    }

    applyPatch(c, patch);
    if (c.status !== ChallengeStatus.DRAFT) {
        const errors = await validateChallenge(c);
        if (errors.length) throw new AppError(errors.join(' '), 400, true, 'INVALID_CONFIG', { errors });
    }
    await c.save();
    await audit({
        actor: ctx, action: deadline && statusIndex(c.status) >= statusIndex(ChallengeStatus.ACTIVE) ? 'challenge.deadline_extended' : 'challenge.update',
        targetType: 'challenge', targetId: c._id, challengeId: c._id,
        before: Object.fromEntries(diff.map((d) => [d.path, d.from])), after: Object.fromEntries(diff.map((d) => [d.path, d.to])),
    });
    await markBoardDirty(c._id);
    return c;
};

// ---------- state machine (§11) ----------

/** The schedule date at which a status may start (manual moves can't run ahead of it). */
const scheduledStart = (c: IAnimChallenge, to: ChallengeStatus): Date | undefined => {
    const s = c.schedule;
    switch (to) {
        case ChallengeStatus.REGISTRATION_OPEN: return s.registrationOpensAt;
        case ChallengeStatus.REGISTRATION_CLOSED: return s.registrationClosesAt;
        case ChallengeStatus.ACTIVE: return s.startsAt;
        case ChallengeStatus.VOTING_OPEN: return s.votingOpensAt;
        case ChallengeStatus.VOTING_CLOSED: return s.votingClosesAt;
        default: return undefined;
    }
};

const notifyCandidates = async (c: IAnimChallenge, kind: string, subject: string, body: string) => {
    const candidates = await AnimCandidate.find({ challengeId: c._id, status: CandidateStatus.APPROVED }).select('userId').lean();
    await Promise.all(candidates.map((cand) => enqueue({
        dedupeKey: `${kind}:${c._id}:${cand.userId}`,
        kind, userId: cand.userId, subject, body, eventId: c.eventId,
        data: { challengeId: String(c._id), challengeName: c.name },
    })));
};

/**
 * One atomic move; side effects after it. `manual` moves (organizer) may not
 * jump ahead of a scheduled date — closing voting early would change the
 * outcome people competed for.
 */
export const transition = async (
    actor: Actor,
    challengeId: string | Types.ObjectId,
    to: ChallengeStatus,
    opts: { reason?: string; manual?: boolean } = {},
): Promise<IAnimChallenge> => {
    const c = await AnimChallenge.findById(challengeId);
    if (!c) throw new AppError('Défi introuvable.', 404);
    const from = c.status;
    if (!canTransition(from, to)) throw new AppError(`Passage de ${from} à ${to} impossible.`, 409, true, 'BAD_TRANSITION');
    if (opts.manual && to !== ChallengeStatus.CANCELLED) {
        const at = scheduledStart(c, to);
        if (at && new Date(at).getTime() > Date.now()) {
            throw new AppError('Cette étape est programmée plus tard : modifiez le calendrier ou attendez la date prévue.', 409, true, 'SCHEDULED_LATER');
        }
    }
    if (to === ChallengeStatus.PROGRAMMED) {
        const event = await Event.findById(c.eventId).select('status').lean();
        if (event?.status !== EventStatus.PUBLISHED) {
            throw new AppError('L’événement doit être validé et publié avant de programmer un défi.', 409, true, 'EVENT_NOT_PUBLISHED');
        }
        const errors = await validateChallenge(c);
        if (errors.length) throw new AppError(errors.join(' '), 400, true, 'INVALID_CONFIG', { errors });
    }
    if (to === ChallengeStatus.VOTING_OPEN) {
        if (allowsPaidVotes(c.voting.mode) && !(await AnimVotePackage.exists({ challengeId: c._id, status: 'ACTIVE' }))) {
            throw new AppError('Ajoutez au moins un pack de votes avant d’ouvrir les votes payants.', 409, true, 'NO_PACKAGE');
        }
        if (usesJury(c.voting.mode) && !(await AnimJuryAssignment.exists({ challengeId: c._id, status: 'ACTIVE' }))) {
            throw new AppError('Ajoutez au moins un juré avant d’ouvrir les votes.', 409, true, 'NO_JURY');
        }
    }
    if (to === ChallengeStatus.COMPLETED) {
        const { AnimResult } = await import('../models/reward.model');
        const frozen = await AnimResult.exists({ challengeId: c._id, status: 'FROZEN' });
        if (!frozen) throw new AppError('Figez le résultat avant de clôturer le défi.', 409, true, 'RESULT_NOT_FROZEN');
    }

    const updated = await AnimChallenge.findOneAndUpdate(
        { _id: c._id, status: from },
        {
            $set: { status: to },
            $push: { statusHistory: { from, to, at: new Date(), by: actor.actorUserId ? new Types.ObjectId(actor.actorUserId) : undefined, reason: opts.reason } },
        },
        { new: true },
    );
    if (!updated) throw new AppError('Le défi a changé entre-temps. Rechargez la page.', 409, true, 'CONCURRENT_CHANGE');

    await audit({
        actor, action: 'challenge.transition', targetType: 'challenge', targetId: c._id,
        organizerId: c.organizerId, eventId: c.eventId, challengeId: c._id,
        before: { status: from }, after: { status: to }, reason: opts.reason,
    });
    await markBoardDirty(c._id);

    try {
        if (to === ChallengeStatus.VOTING_OPEN) {
            await takeSnapshot(updated, 'PHASE');
            await notifyCandidates(updated, 'anim-voting-open', `🗳️ Les votes sont ouverts — ${updated.name}`, 'Partagez votre lien de candidat pour récolter des votes.');
        } else if (to === ChallengeStatus.VOTING_CLOSED) {
            await takeSnapshot(updated, 'PHASE');
            await notifyCandidates(updated, 'anim-voting-closed', `⏱️ Fin des votes — ${updated.name}`, 'Les votes sont clos. Le résultat sera publié après vérification.');
        } else if (to === ChallengeStatus.RESULTS_PENDING) {
            const { computeResult } = await import('./result.service');
            await computeResult(actor, updated._id);
        }
    } catch (err) {
        log.error(`post-transition ${from}→${to} on ${c._id} failed: ${(err as Error).message}`);
    }
    return updated;
};

/**
 * Date-driven moves (job leader, every tick). Walks each challenge forward as
 * far as its schedule allows, one legal step at a time. Phases without dates
 * are skipped automatically only when the schedule makes them meaningless
 * (e.g. no registration window → straight to ACTIVE).
 */
export const autoAdvance = async (now = new Date()): Promise<number> => {
    const live = await AnimChallenge.find({
        status: { $in: [ChallengeStatus.PROGRAMMED, ChallengeStatus.REGISTRATION_OPEN, ChallengeStatus.REGISTRATION_CLOSED, ChallengeStatus.ACTIVE, ChallengeStatus.VOTING_OPEN, ChallengeStatus.VOTING_CLOSED] },
        suspendedAt: { $exists: false },
    }).select('_id status schedule voting').lean();
    let moved = 0;
    const past = (d?: Date) => Boolean(d && new Date(d).getTime() <= now.getTime());
    for (const c of live) {
        const s = c.schedule;
        let next: ChallengeStatus | null = null;
        switch (c.status) {
            case ChallengeStatus.PROGRAMMED:
                if (s.registrationOpensAt) next = past(s.registrationOpensAt) ? ChallengeStatus.REGISTRATION_OPEN : null;
                else if (past(s.startsAt) || past(s.votingOpensAt)) next = ChallengeStatus.ACTIVE;
                break;
            case ChallengeStatus.REGISTRATION_OPEN:
                if (past(s.registrationClosesAt)) next = ChallengeStatus.REGISTRATION_CLOSED;
                break;
            case ChallengeStatus.REGISTRATION_CLOSED:
                if (!s.startsAt || past(s.startsAt)) next = ChallengeStatus.ACTIVE;
                break;
            case ChallengeStatus.ACTIVE:
                if (past(s.votingOpensAt)) next = ChallengeStatus.VOTING_OPEN;
                break;
            case ChallengeStatus.VOTING_OPEN:
                if (past(s.votingClosesAt)) next = ChallengeStatus.VOTING_CLOSED;
                break;
            case ChallengeStatus.VOTING_CLOSED: {
                const graceEnd = s.votingClosesAt ? new Date(new Date(s.votingClosesAt).getTime() + (s.settlementGraceMin ?? 10) * 60_000) : now;
                if (graceEnd.getTime() <= now.getTime()) next = ChallengeStatus.RESULTS_PENDING;
                break;
            }
        }
        if (!next) continue;
        try {
            await transition(SYSTEM_ACTOR, c._id, next, { reason: 'calendrier' });
            moved++;
        } catch (err) {
            log.warn(`auto-advance ${c._id} ${c.status}→${next} refused: ${(err as Error).message}`);
        }
    }
    return moved;
};

// ---------- cancellation (§39) ----------

export const cancelChallenge = async (actor: Actor, challengeId: string | Types.ObjectId, reason: string) => {
    if (!reason?.trim()) throw new AppError('Indiquez le motif de l’annulation.', 400);
    const c = await transition(actor, challengeId, ChallengeStatus.CANCELLED, { reason });
    const { refundChallengeTransactions } = await import('./paid-vote.service');
    const refunded = await refundChallengeTransactions(actor, c._id, `Défi annulé : ${reason}`);
    await AnimChallenge.updateOne({ _id: c._id }, {
        $set: { cancellation: { reason, at: new Date(), by: actor.actorUserId ? new Types.ObjectId(actor.actorUserId) : undefined, refundedTransactions: refunded } },
    });
    await audit({ actor, action: 'challenge.cancel', targetType: 'challenge', targetId: c._id, organizerId: c.organizerId, eventId: c.eventId, challengeId: c._id, reason, after: { refundedTransactions: refunded } });
    const participants = await AnimCandidate.find({ challengeId: c._id, status: { $in: [CandidateStatus.APPROVED, CandidateStatus.PENDING] } }).select('userId').lean();
    await Promise.all(participants.map((p) => enqueue({
        dedupeKey: `anim-challenge-cancelled:${c._id}:${p.userId}`,
        kind: 'anim-challenge-cancelled', userId: p.userId, eventId: c.eventId,
        subject: `⚠️ Défi annulé — ${c.name}`, body: `Le défi « ${c.name} » a été annulé. Motif : ${asSentence(reason)}`,
        data: { challengeId: String(c._id), challengeName: c.name, reason },
    })));
    return { challenge: await AnimChallenge.findById(c._id), refundedTransactions: refunded };
};

/** Event cancelled or suspended → its challenges follow (called from event flows). */
export const cascadeEventStatus = async (eventId: string | Types.ObjectId, status: 'CANCELLED' | 'SUSPENDED' | 'PUBLISHED', reason: string) => {
    const open = await AnimChallenge.find({ eventId, status: { $nin: [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED] } }).select('_id').lean();
    for (const c of open) {
        try {
            if (status === 'CANCELLED') await cancelChallenge(SYSTEM_ACTOR, c._id, reason);
            else if (status === 'SUSPENDED') await AnimChallenge.updateOne({ _id: c._id, suspendedAt: { $exists: false } }, { $set: { suspendedAt: new Date(), suspendedReason: reason } });
            else await AnimChallenge.updateOne({ _id: c._id, suspendedReason: { $regex: '^Événement' } }, { $unset: { suspendedAt: '', suspendedReason: '' } });
        } catch (err) {
            log.error(`cascade ${status} to challenge ${c._id} failed: ${(err as Error).message}`);
        }
    }
};

// ---------- SBC admin: suspension and change requests ----------

export const setSuspended = async (actor: Actor, challengeId: string, suspend: boolean, reason?: string) => {
    const c = await AnimChallenge.findById(challengeId);
    if (!c) throw new AppError('Défi introuvable.', 404);
    if (suspend) {
        if (!reason?.trim()) throw new AppError('Indiquez le motif de la suspension.', 400);
        c.suspendedAt = new Date();
        c.suspendedReason = reason.trim();
    } else {
        c.suspendedAt = undefined;
        c.suspendedReason = undefined;
    }
    await c.save();
    await audit({ actor, action: suspend ? 'challenge.suspend' : 'challenge.resume', targetType: 'challenge', targetId: c._id, organizerId: c.organizerId, eventId: c.eventId, challengeId: c._id, reason });
    await markBoardDirty(c._id);
    return c;
};

export const requestChange = async (ctx: AnimCtx, challengeId: string, body: Record<string, any>, reason: string) => {
    if (!reason?.trim()) throw new AppError('Expliquez la raison de la modification.', 400);
    const c = await loadChallenge(ctx, challengeId);
    if ([ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED].includes(c.status)) throw new AppError('Ce défi est terminé.', 409);
    const patch = shapeChallengeInput({ ...body });
    const diff = changedPaths(c.toObject(), patch);
    if (!diff.length) throw new AppError('Aucun changement demandé.', 400);
    const cr = await AnimChangeRequest.create({
        organizerId: ctx.organizerId, eventId: ctx.eventId, targetType: 'CHALLENGE', targetId: c._id,
        patch, diff, reason: reason.trim(), requestedBy: ctx.actorUserId,
    });
    await audit({ actor: ctx, action: 'change_request.create', targetType: 'change_request', targetId: cr._id, challengeId: c._id, after: diff, reason });
    return cr;
};

/** Applies an approved change request to its challenge or reward rule. */
const applyChangeRequest = async (actor: Actor, cr: IAnimChangeRequest, approve: boolean) => {
    if (approve && cr.targetType === 'REWARD') {
        const ruleId = String((cr.patch as Record<string, unknown>).activateRuleId ?? '');
        const { activateRule } = await import('./reward.service');
        const ctx: AnimCtx = { organizerId: String(cr.organizerId), eventId: String(cr.eventId), actorUserId: actor.actorUserId, role: TeamRole.SBC_ADMIN, perms: [] };
        await activateRule(ctx, ruleId, { override: true });
    }
    if (approve && cr.targetType === 'CHALLENGE') {
        const c = await AnimChallenge.findById(cr.targetId);
        if (!c) throw new AppError('Défi introuvable.', 404);
        if ([ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED].includes(c.status)) {
            throw new AppError('Le défi est terminé : la modification ne peut plus s’appliquer.', 409);
        }
        applyPatch(c, cr.patch as Record<string, any>);
        const errors = await validateChallenge(c);
        if (errors.length) throw new AppError(errors.join(' '), 400, true, 'INVALID_CONFIG', { errors });
        await c.save();
        await markBoardDirty(c._id);
    }
};

/** SBC admin decision. Approval applies the patch past the lock and is logged as an override. */
export const reviewChange = async (actor: Actor, requestId: string, approve: boolean, note?: string) => {
    const cr = await AnimChangeRequest.findOneAndUpdate(
        { _id: requestId, status: ChangeRequestStatus.PENDING },
        { $set: { status: approve ? ChangeRequestStatus.APPROVED : ChangeRequestStatus.REJECTED, reviewedBy: actor.actorUserId, reviewNote: note, reviewedAt: new Date() } },
        { new: true },
    );
    if (!cr) throw new AppError('Demande introuvable ou déjà traitée.', 404);
    // The claim above stops two admins from handling the same request. If the
    // change then can't be applied (invalid now, challenge over), the request
    // goes back to PENDING so it never reads "approved" while nothing changed.
    try {
        await applyChangeRequest(actor, cr, approve);
    } catch (err) {
        await AnimChangeRequest.updateOne(
            { _id: cr._id, status: ChangeRequestStatus.APPROVED },
            { $set: { status: ChangeRequestStatus.PENDING }, $unset: { reviewedBy: '', reviewNote: '', reviewedAt: '' } },
        );
        throw err;
    }
    await audit({
        actor: { ...actor, role: TeamRole.SBC_ADMIN }, action: approve ? 'lock.override' : 'change_request.reject',
        targetType: 'challenge', targetId: cr.targetId, organizerId: cr.organizerId, eventId: cr.eventId, challengeId: cr.targetId,
        after: cr.diff, reason: note,
    });
    const notifyTo = cr.requestedBy;
    const targetName = cr.targetType === 'REWARD'
        ? (await AnimReward.findById(cr.targetId).select('name').lean())?.name
        : (await AnimChallenge.findById(cr.targetId).select('name').lean())?.name;
    const what = targetName ? ` sur « ${targetName} »` : '';
    const why = note?.trim() ? ` Note de l’équipe SBC : ${asSentence(note)}` : '';
    await enqueue({
        dedupeKey: `anim-change-reviewed:${cr._id}`, kind: 'anim-change-reviewed', userId: notifyTo, eventId: cr.eventId,
        subject: approve ? '✅ Modification acceptée' : '⛔ Modification refusée',
        body: (approve
            ? `L’équipe SBC a appliqué la modification demandée${what}.`
            : `L’équipe SBC a refusé la modification demandée${what}.`) + why,
    });
    return cr;
};
