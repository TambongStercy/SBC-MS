import { randomBytes, randomUUID } from 'crypto';
import { Types } from 'mongoose';
import Event from '../../../database/models/event.model';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { AnimCandidate, AnimChallenge } from '../models/challenge.model';
import { AnimChangeRequest } from '../models/governance.model';
import {
    AnimDrawEntrants, AnimReward, AnimRewardDraw, AnimRewardRule, AnimRewardWinner, AnimRuleTick,
    IAnimReward, IAnimRewardRule,
} from '../models/reward.model';
import { AnimVote } from '../models/vote.model';
import {
    AnimCtx, CandidateStatus, EligibilityScope, RewardStatus, RewardType, RuleKind, RuleStatus, RuleTrigger,
    TeamRole, VoteStatus, WinnerStatus,
} from '../types';
import { Actor, SYSTEM_ACTOR, audit } from '../lib/audit';
import { canonical, drawWinners, sha256 } from '../lib/rules';
import { holdsValidTicket, ticketHolderIds } from './eligibility.service';
import { enqueue } from './outbox.service';

const log = logger.getLogger('AnimationRewards');

// ---------- rewards (§4–§5) ----------

const shapeReward = (body: Record<string, any>) => {
    const out: Record<string, unknown> = {};
    if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 120);
    if (body.description !== undefined) out.description = String(body.description).trim().slice(0, 2000);
    if (body.imageFileId !== undefined) out.imageFileId = body.imageFileId ? String(body.imageFileId).slice(0, 200) : undefined;
    if (body.type !== undefined) {
        if (!Object.values(RewardType).includes(body.type)) throw new AppError('Type de récompense invalide.', 400);
        out.type = body.type;
    }
    if (body.customTypeLabel !== undefined) out.customTypeLabel = String(body.customTypeLabel).trim().slice(0, 60);
    if (body.estimatedValue !== undefined) {
        const v = Number(body.estimatedValue);
        if (!(v >= 0)) throw new AppError('Valeur estimée invalide.', 400);
        out.estimatedValue = Math.round(v);
    }
    if (body.quantity !== undefined) {
        const q = Number(body.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 100000) throw new AppError('Quantité invalide (1 à 100 000).', 400);
        out.quantity = q;
    }
    if (body.conditionsText !== undefined) out.conditionsText = String(body.conditionsText).trim().slice(0, 2000);
    for (const k of ['startsAt', 'endsAt']) {
        if (body[k] !== undefined) out[k] = body[k] ? new Date(body[k]) : undefined;
    }
    if (out.startsAt && out.endsAt && (out.startsAt as Date) >= (out.endsAt as Date)) throw new AppError('La date de début doit précéder la fin.', 400);
    if (body.challengeId !== undefined) {
        out.challengeId = body.challengeId && Types.ObjectId.isValid(body.challengeId) ? new Types.ObjectId(body.challengeId) : undefined;
    }
    return out;
};

export const createReward = async (ctx: AnimCtx, body: Record<string, any>) => {
    const input = shapeReward(body);
    if (!input.name || !input.type || !input.quantity) throw new AppError('Nom, type et quantité sont obligatoires.', 400);
    if (input.challengeId && !(await AnimChallenge.exists({ _id: input.challengeId, eventId: ctx.eventId }))) {
        throw new AppError('Défi inconnu pour cet événement.', 400);
    }
    const reward = await AnimReward.create({ ...input, organizerId: ctx.organizerId, eventId: ctx.eventId, createdBy: ctx.actorUserId });
    await audit({ actor: ctx, action: 'reward.create', targetType: 'reward', targetId: reward._id, after: input });
    return reward;
};

/** A reward is locked once someone has won it or the event has started (§8). */
const isLocked = async (reward: IAnimReward) => {
    if (reward.quantityAwarded > 0 || reward.lockedAt) return true;
    const event = await Event.findById(reward.eventId).select('startsAt').lean();
    return Boolean(event && new Date(event.startsAt) <= new Date() && reward.status === RewardStatus.ACTIVE);
};

const REWARD_SENSITIVE = ['type', 'quantity', 'estimatedValue', 'conditionsText', 'startsAt', 'endsAt', 'challengeId'];

export const updateReward = async (ctx: AnimCtx, rewardId: string, body: Record<string, any>) => {
    const reward = await AnimReward.findOne({ _id: rewardId, eventId: ctx.eventId });
    if (!reward) throw new AppError('Récompense introuvable.', 404);
    const input = shapeReward(body);
    if (await isLocked(reward)) {
        const sensitive = Object.keys(input).filter((k) => REWARD_SENSITIVE.includes(k) && String((reward as any)[k] ?? '') !== String(input[k] ?? ''));
        // More stock is always fine; less stock, other values or dates are not.
        const onlyMoreStock = sensitive.length === 1 && sensitive[0] === 'quantity' && Number(input.quantity) > reward.quantity;
        if (sensitive.length && !onlyMoreStock) {
            throw new AppError('Cette récompense est verrouillée. Faites une demande de modification.', 409, true, 'LOCKED_FIELDS', { fields: sensitive });
        }
    }
    if (input.quantity !== undefined && Number(input.quantity) < reward.quantityAwarded) {
        throw new AppError(`Déjà ${reward.quantityAwarded} attribuée(s) : la quantité ne peut pas être inférieure.`, 409);
    }
    const before = reward.toObject();
    Object.assign(reward, input);
    if (reward.status === RewardStatus.EXHAUSTED && reward.quantity > reward.quantityAwarded) reward.status = RewardStatus.ACTIVE;
    await reward.save();
    await audit({ actor: ctx, action: 'reward.update', targetType: 'reward', targetId: reward._id, before: Object.fromEntries(Object.keys(input).map((k) => [k, (before as any)[k]])), after: input });
    return reward;
};

export const cancelReward = async (ctx: AnimCtx, rewardId: string, reason: string) => {
    if (!reason?.trim()) throw new AppError('Indiquez le motif.', 400);
    const reward = await AnimReward.findOne({ _id: rewardId, eventId: ctx.eventId });
    if (!reward) throw new AppError('Récompense introuvable.', 404);
    if (reward.quantityAwarded > 0) throw new AppError('Des gagnants existent déjà : la récompense ne peut plus être annulée.', 409);
    reward.status = RewardStatus.CANCELLED;
    await reward.save();
    await AnimRewardRule.updateMany({ rewardId: reward._id, status: RuleStatus.ACTIVE }, { $set: { status: RuleStatus.SUPERSEDED } });
    await audit({ actor: ctx, action: 'reward.cancel', targetType: 'reward', targetId: reward._id, reason });
    return reward;
};

// ---------- rules: immutable versions (§7–§8) ----------

const TRIGGERED = [RuleKind.POSITION, RuleKind.PERIODIC, RuleKind.ACTION];

const shapeRule = async (eventId: string, body: Record<string, any>) => {
    const kind = body.kind as RuleKind;
    if (!Object.values(RuleKind).includes(kind)) throw new AppError('Type de règle invalide.', 400);
    const p = body.params ?? {};
    const e = body.eligibility ?? {};
    const int = (v: unknown, name: string, min = 1) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min) throw new AppError(`« ${name} » doit être un entier ≥ ${min}.`, 400);
        return n;
    };
    const params: Record<string, unknown> = { onePerUser: p.onePerUser !== false };
    let trigger: RuleTrigger | undefined;
    if (TRIGGERED.includes(kind)) {
        trigger = body.trigger;
        if (!Object.values(RuleTrigger).includes(trigger as RuleTrigger)) throw new AppError('Choisissez l’action qui déclenche la règle.', 400);
        if (kind === RuleKind.POSITION) params.position = int(p.position, 'position');
        if (kind === RuleKind.PERIODIC) params.every = int(p.every, 'fréquence', 2);
        if (kind === RuleKind.ACTION) params.firstN = int(p.firstN, 'nombre de premiers');
    }
    if (kind === RuleKind.RANDOM_DRAW) {
        params.winners = int(p.winners, 'nombre de gagnants');
        if (p.drawAt) params.drawAt = new Date(p.drawAt);
    }
    if (kind === RuleKind.CHALLENGE_RANK) {
        params.rankFrom = int(p.rankFrom ?? 1, 'rang de départ');
        params.rankTo = int(p.rankTo ?? params.rankFrom, 'rang de fin');
        if ((params.rankTo as number) < (params.rankFrom as number)) throw new AppError('Rangs invalides.', 400);
    }
    const challengeIdRaw = p.challengeId ?? e.challengeId;
    if (challengeIdRaw) {
        if (!Types.ObjectId.isValid(challengeIdRaw) || !(await AnimChallenge.exists({ _id: challengeIdRaw, eventId }))) {
            throw new AppError('Défi inconnu pour cet événement.', 400);
        }
        params.challengeId = new Types.ObjectId(challengeIdRaw);
    }
    if (kind === RuleKind.CHALLENGE_RANK && !params.challengeId) throw new AppError('Choisissez le défi classé.', 400);
    const scope = (e.scope ?? EligibilityScope.ALL_PARTICIPANTS) as EligibilityScope;
    if (!Object.values(EligibilityScope).includes(scope)) throw new AppError('Éligibilité invalide.', 400);
    const ticketTypeIds = Array.isArray(e.ticketTypeIds) ? e.ticketTypeIds.filter((x: string) => Types.ObjectId.isValid(x)).map((x: string) => new Types.ObjectId(x)) : [];
    if (scope === EligibilityScope.TICKET_TYPES && !ticketTypeIds.length) throw new AppError('Choisissez au moins un type de billet.', 400);
    if ((scope === EligibilityScope.CHALLENGE_PARTICIPANTS || scope === EligibilityScope.CHALLENGE_VOTERS) && !params.challengeId) {
        throw new AppError('Choisissez le défi concerné.', 400);
    }
    const eligibility = { scope, ticketTypeIds, challengeId: params.challengeId };
    return { kind, trigger, params, eligibility };
};

export const createRuleVersion = async (ctx: AnimCtx, rewardId: string, body: Record<string, any>, actorOverride?: Actor) => {
    const reward = await AnimReward.findOne({ _id: rewardId, eventId: ctx.eventId });
    if (!reward) throw new AppError('Récompense introuvable.', 404);
    if ([RewardStatus.CANCELLED, RewardStatus.CLOSED].includes(reward.status)) throw new AppError('Récompense close.', 409);
    const def = await shapeRule(ctx.eventId, body);
    const last = await AnimRewardRule.findOne({ rewardId: reward._id }).sort({ version: -1 }).select('version').lean();
    const rule = await AnimRewardRule.create({
        ...def, organizerId: ctx.organizerId, eventId: ctx.eventId, rewardId: reward._id,
        version: (last?.version ?? 0) + 1, status: RuleStatus.DRAFT,
        definitionHash: sha256(canonical(def)), createdBy: ctx.actorUserId,
    });
    await audit({ actor: actorOverride ?? ctx, action: 'rule.create', targetType: 'reward_rule', targetId: rule._id, after: { rewardId: String(reward._id), version: rule.version, ...def } });
    return rule;
};

/**
 * Activates a rule version. Replacing the active rule of a locked reward (a
 * winner exists or the event started) needs an SBC-approved change request.
 */
export const activateRule = async (ctx: AnimCtx, ruleId: string, opts: { override?: boolean } = {}) => {
    const rule = await AnimRewardRule.findOne({ _id: ruleId, eventId: ctx.eventId });
    if (!rule) throw new AppError('Règle introuvable.', 404);
    if (rule.status === RuleStatus.ACTIVE) return rule;
    if (rule.status !== RuleStatus.DRAFT) throw new AppError('Cette version a été remplacée.', 409);
    const reward = await AnimReward.findById(rule.rewardId);
    if (!reward || [RewardStatus.CANCELLED, RewardStatus.CLOSED].includes(reward.status)) throw new AppError('Récompense close.', 409);
    const current = await AnimRewardRule.findOne({ rewardId: rule.rewardId, status: RuleStatus.ACTIVE });
    if (current && !opts.override && (await isLocked(reward))) {
        throw new AppError('La règle active est verrouillée. Faites une demande de modification.', 409, true, 'RULE_LOCKED');
    }
    if (current) await AnimRewardRule.updateOne({ _id: current._id, status: RuleStatus.ACTIVE }, { $set: { status: RuleStatus.SUPERSEDED } });
    try {
        await AnimRewardRule.updateOne({ _id: rule._id, status: RuleStatus.DRAFT }, { $set: { status: RuleStatus.ACTIVE, activatedAt: new Date(), activatedBy: ctx.actorUserId || undefined } });
    } catch (err: any) {
        if (err?.code === 11000) throw new AppError('Une autre règle vient d’être activée. Rechargez.', 409, true, 'CONCURRENT_CHANGE');
        throw err;
    }
    reward.activeRuleId = rule._id;
    if (reward.status === RewardStatus.DRAFT) reward.status = reward.quantityAwarded >= reward.quantity ? RewardStatus.EXHAUSTED : RewardStatus.ACTIVE;
    await reward.save();
    if (rule.kind === RuleKind.RANDOM_DRAW) {
        const seed = randomBytes(32).toString('hex');
        await AnimRewardDraw.updateOne(
            { ruleId: rule._id },
            { $setOnInsert: { ruleId: rule._id, rewardId: reward._id, eventId: reward.eventId, status: 'SCHEDULED', scheduledAt: rule.params.drawAt, seedCommitment: sha256(seed), seed, winners: [] } },
            { upsert: true },
        );
    }
    await audit({
        actor: ctx, action: opts.override ? 'lock.override' : 'rule.activate', targetType: 'reward_rule', targetId: rule._id,
        before: current ? { activeRule: String(current._id), version: current.version } : undefined,
        after: { activeRule: String(rule._id), version: rule.version, definitionHash: rule.definitionHash },
    });
    return AnimRewardRule.findById(rule._id);
};

export const requestRuleChange = async (ctx: AnimCtx, ruleId: string, reason: string) => {
    if (!reason?.trim()) throw new AppError('Expliquez la raison.', 400);
    const rule = await AnimRewardRule.findOne({ _id: ruleId, eventId: ctx.eventId, status: RuleStatus.DRAFT });
    if (!rule) throw new AppError('Version introuvable.', 404);
    return AnimChangeRequest.create({
        organizerId: ctx.organizerId, eventId: ctx.eventId, targetType: 'REWARD', targetId: rule.rewardId,
        patch: { activateRuleId: String(rule._id) }, diff: [{ path: 'activeRule', from: null, to: rule.version }],
        reason: reason.trim(), requestedBy: ctx.actorUserId,
    });
};

// ---------- eligibility ----------

const isEligible = async (rule: IAnimRewardRule, userId: string) => {
    const e = rule.eligibility;
    switch (e.scope) {
        case EligibilityScope.TICKET_HOLDERS: return holdsValidTicket(userId, rule.eventId);
        case EligibilityScope.TICKET_TYPES: return holdsValidTicket(userId, rule.eventId, e.ticketTypeIds);
        case EligibilityScope.CHALLENGE_PARTICIPANTS:
            return Boolean(await AnimCandidate.exists({ challengeId: e.challengeId, userId, status: { $in: [CandidateStatus.APPROVED, CandidateStatus.PENDING] } }));
        case EligibilityScope.CHALLENGE_VOTERS:
            return Boolean(await AnimVote.exists({ challengeId: e.challengeId, voterUserId: userId, status: VoteStatus.COUNTED }));
        default: return true;
    }
};

const eligibleUserIds = async (rule: IAnimRewardRule): Promise<string[]> => {
    const e = rule.eligibility;
    switch (e.scope) {
        case EligibilityScope.TICKET_HOLDERS: return ticketHolderIds(rule.eventId);
        case EligibilityScope.TICKET_TYPES: return ticketHolderIds(rule.eventId, e.ticketTypeIds);
        case EligibilityScope.CHALLENGE_PARTICIPANTS:
            return (await AnimCandidate.distinct('userId', { challengeId: e.challengeId, status: CandidateStatus.APPROVED })).map(String);
        case EligibilityScope.CHALLENGE_VOTERS:
            return (await AnimVote.distinct('voterUserId', { challengeId: e.challengeId, status: VoteStatus.COUNTED })).map(String);
        default: {
            // Everyone who took part in the event: ticket holders, candidates and voters.
            const [holders, cands, voters] = await Promise.all([
                ticketHolderIds(rule.eventId),
                AnimCandidate.distinct('userId', { eventId: rule.eventId, status: CandidateStatus.APPROVED }),
                AnimVote.distinct('voterUserId', { eventId: rule.eventId, status: VoteStatus.COUNTED }),
            ]);
            return [...new Set([...holders, ...cands.map(String), ...voters.map(String)])];
        }
    }
};

// ---------- awarding ----------

const rewardActiveNow = (reward: IAnimReward) => {
    const now = Date.now();
    return reward.status === RewardStatus.ACTIVE
        && (!reward.startsAt || new Date(reward.startsAt).getTime() <= now)
        && (!reward.endsAt || new Date(reward.endsAt).getTime() > now);
};

/**
 * Hands out one unit: capacity reserved atomically (never more winners than
 * stock), then the winner row (unique per rule slot). A replayed award hits
 * the unique index and gives the unit back.
 */
export const awardSlot = async (rule: IAnimRewardRule, args: { userId: string; slotKey: string; candidateId?: string; sharePct?: number; actor?: Actor }) => {
    if (rule.params.onePerUser && await AnimRewardWinner.exists({ rewardId: rule.rewardId, userId: args.userId, status: { $ne: WinnerStatus.REVOKED } })) {
        return null;
    }
    const reserved = await AnimReward.findOneAndUpdate(
        { _id: rule.rewardId, status: RewardStatus.ACTIVE, $expr: { $lt: ['$quantityAwarded', '$quantity'] } },
        { $inc: { quantityAwarded: 1 }, $set: { lockedAt: new Date() } },
        { new: true },
    );
    if (!reserved) return null;
    try {
        const winner = await AnimRewardWinner.create({
            organizerId: rule.organizerId, eventId: rule.eventId, challengeId: rule.params.challengeId, rewardId: rule.rewardId,
            ruleId: rule._id, ruleVersion: rule.version, slotKey: args.slotKey, userId: args.userId,
            candidateId: args.candidateId, sharePct: args.sharePct ?? 100,
        });
        if (reserved.quantityAwarded >= reserved.quantity) {
            await AnimReward.updateOne({ _id: reserved._id, status: RewardStatus.ACTIVE }, { $set: { status: RewardStatus.EXHAUSTED } });
        }
        await audit({
            actor: args.actor ?? SYSTEM_ACTOR, action: 'reward.award', targetType: 'reward_winner', targetId: winner._id,
            organizerId: rule.organizerId, eventId: rule.eventId, challengeId: rule.params.challengeId,
            after: { rewardId: String(rule.rewardId), ruleVersion: rule.version, slotKey: args.slotKey, userId: args.userId, sharePct: winner.sharePct },
        });
        await enqueue({
            dedupeKey: `anim-reward-won:${winner._id}`, kind: 'anim-reward-won', userId: args.userId, eventId: rule.eventId,
            subject: `🎁 Vous avez gagné : ${reserved.name}`,
            body: `Félicitations ! Vous remportez « ${reserved.name} ». L’organisateur vous contactera pour la remise.`,
            data: { rewardId: String(reserved._id), rewardName: reserved.name },
        });
        return winner;
    } catch (err: any) {
        await AnimReward.updateOne({ _id: reserved._id }, { $inc: { quantityAwarded: -1 } });
        if (err?.code === 11000) return null;
        throw err;
    }
};

/**
 * The engine (§6). Called from ticket settlement, check-in, registrations,
 * approvals and votes. Never throws: a reward must not break a sale.
 *
 * Counting is replay-safe: a subject is counted once per rule (unique tick),
 * then numbered by an atomic counter.
 */
export const onTrigger = async (t: { trigger: RuleTrigger; eventId: string; challengeId?: string; userId: string; subjectKey: string }) => {
    try {
        const rules = await AnimRewardRule.find({ eventId: t.eventId, trigger: t.trigger, status: RuleStatus.ACTIVE, kind: { $in: TRIGGERED } });
        for (const rule of rules) {
            try {
                if (rule.params.challengeId && String(rule.params.challengeId) !== t.challengeId) continue;
                const reward = await AnimReward.findById(rule.rewardId);
                if (!reward || !rewardActiveNow(reward)) continue;
                if (!(await isEligible(rule, t.userId))) continue;
                const subjectKey = rule.params.onePerUser ? `user:${t.userId}` : t.subjectKey;
                try {
                    await AnimRuleTick.create({ ruleId: rule._id, eventId: rule.eventId, subjectKey, userId: t.userId });
                } catch (err: any) {
                    if (err?.code === 11000) continue; // already counted
                    throw err;
                }
                await numberTick(rule, subjectKey, t.userId);
            } catch (err) {
                log.error(`reward rule ${rule._id} on ${t.trigger} failed: ${(err as Error).message}`);
            }
        }
    } catch (err) {
        log.error(`onTrigger ${t.trigger} failed: ${(err as Error).message}`);
    }
};

const numberTick = async (rule: IAnimRewardRule, subjectKey: string, userId: string) => {
    const counted = await AnimRewardRule.findOneAndUpdate({ _id: rule._id }, { $inc: { counter: 1 } }, { new: true }).select('counter');
    if (!counted) return;
    const ordinal = counted.counter;
    await AnimRuleTick.updateOne({ ruleId: rule._id, subjectKey }, { $set: { ordinal } });
    const p = rule.params;
    const hit = (rule.kind === RuleKind.POSITION && ordinal === p.position)
        || (rule.kind === RuleKind.PERIODIC && p.every && ordinal % p.every === 0)
        || (rule.kind === RuleKind.ACTION && p.firstN && ordinal <= p.firstN);
    if (!hit) return;
    await waitForPreviousHit(rule, ordinal);
    try {
        await awardSlot(rule, { userId, slotKey: `ord:${ordinal}` });
    } finally {
        await AnimRuleTick.updateOne({ ruleId: rule._id, subjectKey }, { $set: { decidedAt: new Date() } });
    }
};

/**
 * Hits of a rule are decided in order. Under a burst the request numbered 10
 * can reach the stock after those numbered 20…60; first-come stock would then
 * give "every 10th buyer" prizes to the 20th…60th. So a hit waits until the
 * previous hit of the same rule is decided (normally milliseconds; at most
 * 3 s, in case that request died). Then stock is first-come again, which
 * keeps revocations simple: a returned unit goes to the next hit.
 */
const waitForPreviousHit = async (rule: IAnimRewardRule, ordinal: number) => {
    const p = rule.params;
    const previous = rule.kind === RuleKind.PERIODIC ? ordinal - Number(p.every) : rule.kind === RuleKind.ACTION ? ordinal - 1 : 0;
    if (previous < 1) return;
    for (let i = 0; i < 30; i++) {
        if (await AnimRuleTick.exists({ ruleId: rule._id, ordinal: previous, decidedAt: { $exists: true } })) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    log.warn(`rule ${rule._id}: hit ${previous} still undecided after 3 s — deciding ${ordinal} anyway`);
};

/** Job: ticks left un-numbered by a crash between their insert and the counter. */
export const sweepOrphanTicks = async (): Promise<number> => {
    const orphans = await AnimRuleTick.find({ ordinal: { $exists: false }, at: { $lt: new Date(Date.now() - 60_000) } }).sort({ at: 1 }).limit(100).lean();
    for (const tick of orphans) {
        const rule = await AnimRewardRule.findById(tick.ruleId);
        if (rule?.status === RuleStatus.ACTIVE) await numberTick(rule, tick.subjectKey, String(tick.userId));
        else await AnimRuleTick.updateOne({ _id: tick._id }, { $set: { ordinal: 0 } });
    }
    return orphans.length;
};

// ---------- random draws ----------

/**
 * Runs a draw (§6): entrants frozen at draw time, stored as sorted sha256 of
 * user ids (verifiable without exposing who held tickets), seed committed in
 * advance and revealed afterwards. Re-running after a crash reuses the frozen
 * entrants and the same seed, so it reaches the same winners.
 */
export const runDraw = async (ruleId: Types.ObjectId | string, actor: Actor = SYSTEM_ACTOR) => {
    const draw = await AnimRewardDraw.findOneAndUpdate(
        { ruleId, $or: [{ status: 'SCHEDULED' }, { status: 'RUNNING', leaseUntil: { $lt: new Date() } }] },
        { $set: { status: 'RUNNING', leaseUntil: new Date(Date.now() + 5 * 60_000) } },
        { new: true },
    ).select('+seed');
    if (!draw) {
        const done = await AnimRewardDraw.findOne({ ruleId }).lean();
        if (done?.status === 'DONE') return done;
        throw new AppError('Tirage déjà en cours.', 409, true, 'DRAW_RUNNING');
    }
    const rule = await AnimRewardRule.findById(ruleId);
    if (!rule || rule.status !== RuleStatus.ACTIVE) throw new AppError('Règle inactive.', 409);
    const reward = await AnimReward.findById(rule.rewardId);
    if (!reward) throw new AppError('Récompense introuvable.', 404);

    const byHash = new Map<string, string>();
    let hashes: string[];
    const stored = await AnimDrawEntrants.find({ drawId: draw._id }).sort({ chunk: 1 }).lean();
    const users = await eligibleUserIds(rule);
    for (const u of users) byHash.set(sha256(`${u}:${draw._id}`), u);
    if (stored.length) {
        hashes = stored.flatMap((s) => s.userIds);
    } else {
        hashes = [...byHash.keys()].sort();
        for (let i = 0; i * 5000 < hashes.length; i++) {
            await AnimDrawEntrants.updateOne({ drawId: draw._id, chunk: i }, { $setOnInsert: { userIds: hashes.slice(i * 5000, (i + 1) * 5000) } }, { upsert: true });
        }
        await AnimRewardDraw.updateOne({ _id: draw._id }, { $set: { eligibleCount: hashes.length, eligibleSetHash: sha256(hashes.join('\n')) } });
    }
    const remaining = Math.max(0, reward.quantity - reward.quantityAwarded);
    const picked = drawWinners(hashes, Math.min(rule.params.winners ?? 1, hashes.length), draw.seed);
    const winners: { position: number; userId: Types.ObjectId }[] = [];
    let awarded = 0;
    for (let i = 0; i < picked.length; i++) {
        const userId = byHash.get(picked[i]);
        if (!userId) continue; // left the event since entrants were frozen: their slot stays empty, provably
        winners.push({ position: i + 1, userId: new Types.ObjectId(userId) });
        if (awarded < remaining || (await AnimRewardWinner.exists({ ruleId: rule._id, slotKey: `draw:${i + 1}` }))) {
            const w = await awardSlot(rule, { userId, slotKey: `draw:${i + 1}`, actor });
            if (w) awarded++;
        }
    }
    await AnimRewardDraw.updateOne({ _id: draw._id }, { $set: { status: 'DONE', winners, drawnAt: new Date() }, $unset: { leaseUntil: '' } });
    await audit({ actor, action: 'reward.draw', targetType: 'reward_draw', targetId: draw._id, organizerId: rule.organizerId, eventId: rule.eventId, after: { entrants: hashes.length, winners: winners.length } });
    return AnimRewardDraw.findById(draw._id).lean();
};

export const runDueDraws = async (): Promise<number> => {
    const due = await AnimRewardDraw.find({ status: 'SCHEDULED', scheduledAt: { $lte: new Date() } }).limit(20).select('ruleId').lean();
    for (const d of due) {
        try { await runDraw(d.ruleId); } catch (err) { log.error(`draw ${d._id} failed: ${(err as Error).message}`); }
    }
    return due.length;
};

export const drawNow = async (ctx: AnimCtx, ruleId: string) => {
    const rule = await AnimRewardRule.findOne({ _id: ruleId, eventId: ctx.eventId, kind: RuleKind.RANDOM_DRAW });
    if (!rule) throw new AppError('Tirage introuvable.', 404);
    if (rule.params.drawAt && new Date(rule.params.drawAt) > new Date()) {
        throw new AppError('Le tirage est programmé plus tard.', 409, true, 'SCHEDULED_LATER');
    }
    return runDraw(rule._id, ctx);
};

/** Public proof: commitment, revealed seed, entrant hashes, winners (§27-style transparency for draws). */
export const drawProof = async (drawId: string) => {
    if (!Types.ObjectId.isValid(drawId)) throw new AppError('Tirage introuvable.', 404);
    const draw = await AnimRewardDraw.findById(drawId).select('+seed').lean();
    if (!draw) throw new AppError('Tirage introuvable.', 404);
    const entrants = draw.status === 'DONE' ? (await AnimDrawEntrants.find({ drawId: draw._id }).sort({ chunk: 1 }).lean()).flatMap((c) => c.userIds) : [];
    const [reward, rule] = await Promise.all([
        AnimReward.findById(draw.rewardId).select('name').lean(),
        AnimRewardRule.findById(draw.ruleId).select('params.winners').lean(),
    ]);
    return {
        drawId: String(draw._id), reward: reward?.name, status: draw.status, scheduledAt: draw.scheduledAt, drawnAt: draw.drawnAt,
        seedCommitment: draw.seedCommitment, seed: draw.status === 'DONE' ? draw.seed : undefined,
        eligibleCount: draw.eligibleCount, eligibleSetHash: draw.eligibleSetHash, entrantHashes: entrants,
        winnerPositions: draw.winners.map((w) => w.position),
        requestedWinners: rule?.params?.winners,
        // What the server picked, comparable with a recomputation from seed + entrants.
        winnerHashes: draw.status === 'DONE' ? draw.winners.map((w) => sha256(`${w.userId}:${draw._id}`)) : [],
        method: 'Tri des empreintes sha256(userId:drawId), mélange de Fisher–Yates partiel piloté par HMAC-SHA256(seed, compteur), échantillonnage par rejet.',
    };
};

// ---------- manual and rank rewards ----------

export const manualAward = async (ctx: AnimCtx, rewardId: string, body: { userId?: string; note?: string }) => {
    const reward = await AnimReward.findOne({ _id: rewardId, eventId: ctx.eventId });
    if (!reward) throw new AppError('Récompense introuvable.', 404);
    const rule = reward.activeRuleId ? await AnimRewardRule.findById(reward.activeRuleId) : null;
    if (!rule || rule.kind !== RuleKind.MANUAL || rule.status !== RuleStatus.ACTIVE) {
        throw new AppError('Activez une règle « attribution manuelle » pour cette récompense.', 409, true, 'NOT_MANUAL');
    }
    if (!body.userId || !Types.ObjectId.isValid(body.userId)) throw new AppError('Choisissez le bénéficiaire.', 400);
    if (!(await isEligible(rule, body.userId))) throw new AppError('Ce membre n’est pas éligible à cette récompense.', 409, true, 'NOT_ELIGIBLE');
    const winner = await awardSlot(rule, { userId: body.userId, slotKey: `manual:${randomUUID()}`, actor: ctx });
    if (!winner) throw new AppError('Stock épuisé, récompense inactive, ou ce membre l’a déjà gagnée.', 409, true, 'NOT_AWARDED');
    if (body.note) await AnimRewardWinner.updateOne({ _id: winner._id }, { $set: { deliveryNote: String(body.note).slice(0, 1000) } });
    return winner;
};

/**
 * At result freeze: each rank prize of the challenge goes to the candidate(s)
 * at that rank. A shared rank (SPLIT_PRIZE) gives every tied candidate a share.
 */
export const awardRankRewards = async (challengeId: Types.ObjectId, entries: { rank: number; userId: Types.ObjectId; candidateId: Types.ObjectId; sharedRank?: boolean }[], actor: Actor) => {
    const challenge = await AnimChallenge.findById(challengeId).lean();
    if (!challenge?.rankRewards?.length) return 0;
    let n = 0;
    for (const rr of challenge.rankRewards) {
        const reward = await AnimReward.findById(rr.rewardId);
        if (!reward || [RewardStatus.CANCELLED, RewardStatus.CLOSED].includes(reward.status)) continue;
        let rule = await AnimRewardRule.findOne({ rewardId: reward._id, status: RuleStatus.ACTIVE, kind: RuleKind.CHALLENGE_RANK, 'params.challengeId': challengeId });
        if (!rule) {
            const ctx: AnimCtx = { organizerId: String(challenge.organizerId), eventId: String(challenge.eventId), actorUserId: actor.actorUserId || String(challenge.createdBy), role: TeamRole.SYSTEM, perms: [] };
            const draft = await createRuleVersion(ctx, String(reward._id), {
                kind: RuleKind.CHALLENGE_RANK, params: { challengeId: String(challengeId), rankFrom: rr.rank, rankTo: rr.rank, onePerUser: false },
            }, actor);
            rule = await activateRule(ctx, String(draft._id), { override: true });
        }
        if (!rule) continue;
        if (reward.status === RewardStatus.DRAFT) await AnimReward.updateOne({ _id: reward._id }, { $set: { status: RewardStatus.ACTIVE } });
        const atRank = entries.filter((e) => e.rank === rr.rank);
        // One unit per tied winner — the stock must cover it, the shares split the value.
        for (const e of atRank) {
            const w = await awardSlot(rule, {
                userId: String(e.userId), candidateId: String(e.candidateId),
                slotKey: `rank:${rr.rank}:${e.candidateId}`, sharePct: Math.round(100 / atRank.length), actor,
            });
            if (w) n++;
        }
    }
    return n;
};

export const setWinnerStatus = async (ctx: AnimCtx, winnerId: string, action: 'deliver' | 'forfeit' | 'revoke', body: { note?: string; proofFileId?: string }) => {
    const winner = await AnimRewardWinner.findOne({ _id: winnerId, eventId: ctx.eventId });
    if (!winner) throw new AppError('Gagnant introuvable.', 404);
    if (winner.status !== WinnerStatus.AWARDED) throw new AppError('Déjà traité.', 409);
    if (action !== 'deliver' && !body.note?.trim()) throw new AppError('Indiquez le motif.', 400);
    const to = { deliver: WinnerStatus.DELIVERED, forfeit: WinnerStatus.FORFEITED, revoke: WinnerStatus.REVOKED }[action];
    const res = await AnimRewardWinner.updateOne({ _id: winner._id, status: WinnerStatus.AWARDED }, {
        $set: { status: to, deliveredAt: new Date(), deliveredBy: ctx.actorUserId, deliveryNote: body.note?.slice(0, 1000), proofFileId: body.proofFileId },
    });
    if (!res.modifiedCount) throw new AppError('Déjà traité.', 409);
    if (to === WinnerStatus.REVOKED) {
        // A revoked unit goes back to stock.
        await AnimReward.updateOne({ _id: winner.rewardId }, { $inc: { quantityAwarded: -1 } });
        await AnimReward.updateOne({ _id: winner.rewardId, status: RewardStatus.EXHAUSTED }, { $set: { status: RewardStatus.ACTIVE } });
    }
    await audit({ actor: ctx, action: `reward.${action}`, targetType: 'reward_winner', targetId: winner._id, after: { status: to }, reason: body.note });
    return AnimRewardWinner.findById(winner._id);
};

export const listRewards = (ctx: Pick<AnimCtx, 'eventId'>) => AnimReward.find({ eventId: ctx.eventId }).sort({ createdAt: -1 }).lean();
export const listRules = (ctx: Pick<AnimCtx, 'eventId'>, rewardId: string) => AnimRewardRule.find({ eventId: ctx.eventId, rewardId }).sort({ version: -1 }).lean();
export const listWinners = (ctx: Pick<AnimCtx, 'eventId'>, rewardId?: string) =>
    AnimRewardWinner.find({ eventId: ctx.eventId, ...(rewardId ? { rewardId } : {}) }).sort({ awardedAt: -1 }).limit(1000).lean();
export const myRewards = (userId: string) =>
    AnimRewardWinner.find({ userId }).sort({ awardedAt: -1 }).limit(100).lean();
