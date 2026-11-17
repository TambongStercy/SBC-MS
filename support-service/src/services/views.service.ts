import { Types, FilterQuery } from 'mongoose';
import { ACTIVE_VIEW_STATES } from '../config/constants';
import { Agent } from '../database/models/agent.model';
import { AssignmentHistory, IViewTask, ViewTask } from '../database/models/view-task.model';
import { withLockWait } from '../lib/lock';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { decideProof, getProof, listPendingProofs } from './clients/advertising.client';
import { getSetting, isKillSwitchOn } from './settings.service';
import { notifyAgents } from './notifier.service';
import logger from '../utils/logger';

const log = logger.getLogger('Views');

/**
 * WhatsApp-views verification (addendum 1.2). One task = one video proof.
 * Assignment is a single conditional write (available → assigned), and the
 * partial unique index on sourceId for active states makes two active
 * assignments of one proof impossible at the database level.
 */

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

async function history(task: { _id: unknown; sourceId: string }, kind: string, from: string | null, to: string | null, by: string | null, reason?: string | null) {
    await AssignmentHistory.create({ taskId: task._id, sourceId: task.sourceId, kind, from, to, by, reason: reason ?? null, at: new Date() });
}

/** Idempotent on sourceId (internal route and catch-up job). */
export async function upsertViewTask(input: Record<string, unknown>): Promise<{ taskId: string; created: boolean }> {
    const sourceId = str(input.sourceId, 64);
    if (!sourceId) throw badRequest('sourceId required', 'BAD_SOURCE');
    const submittedAt = input.submittedAt ? new Date(String(input.submittedAt)) : new Date();
    if (Number.isNaN(submittedAt.getTime())) throw badRequest('submittedAt invalid', 'BAD_DATE');
    const dayIndex = Number.isInteger(input.dayIndex) ? (input.dayIndex as number) : null;
    try {
        const res = await ViewTask.findOneAndUpdate(
            { sourceId },
            {
                $setOnInsert: {
                    sourceId, submittedAt, campaignId: str(input.campaignId, 64), diffuseurUserId: str(input.diffuseurUserId, 64),
                    dayIndex, country: str(input.country, 8), state: 'available', version: 0, requeueCount: 0,
                },
            },
            { upsert: true, new: true, includeResultMetadata: true },
        );
        return { taskId: String(res.value!._id), created: !res.lastErrorObject?.updatedExisting };
    } catch (err: any) {
        if (err?.code === 11000) {
            const t = await ViewTask.findOne({ sourceId }, { _id: 1 }).lean();
            if (t) return { taskId: String(t._id), created: false };
        }
        throw err;
    }
}

/**
 * "Next task": the agent's current active task if any (double click or a
 * retried request returns the same one), otherwise the oldest available
 * proof, claimed atomically. Requests from one agent are serialised with a
 * Redis lock so they cannot claim two tasks at once.
 */
export async function claimNextTask(agent: { id: string }): Promise<{ task: IViewTask | null; reason?: string }> {
    const mode = await getSetting<string>('views.assignmentMode');
    return withLockWait(`views:claim:${agent.id}`, 10_000, 5_000, async () => {
        const assigneeId = new Types.ObjectId(agent.id);
        const current = await ViewTask.findOne({ assigneeId, state: { $in: ACTIVE_VIEW_STATES } }).sort({ assignedAt: 1 }).lean();
        if (current) return { task: current };
        if (mode === 'manual') return { task: null, reason: 'Mode manuel : un superviseur vous attribuera une tâche.' };
        if (await isKillSwitchOn('autoAssignment')) return { task: null, reason: 'L’affectation automatique est coupée. Attendez une affectation du superviseur.' };
        const now = new Date();
        for (let i = 0; i < 5; i++) {
            try {
                const task = await ViewTask.findOneAndUpdate(
                    { state: 'available' },
                    { $set: { state: 'assigned', assigneeId, assignedAt: now, startedAt: null, lastActivityAt: now, idleAlertedAt: null }, $inc: { version: 1 } },
                    { sort: { submittedAt: 1 }, new: true },
                ).lean();
                if (!task) return { task: null, reason: 'Aucune preuve à vérifier pour le moment.' };
                await history(task, 'claim', null, agent.id, agent.id);
                await Agent.updateOne({ _id: agent.id }, { $set: { 'views.lastAssignedAt': now, 'views.lastSeenAt': now } });
                return { task };
            } catch (err: any) {
                if (err?.code === 11000) continue; // the index refused a second active assignment: try the next one
                throw err;
            }
        }
        return { task: null, reason: 'Réessayez dans un instant.' };
    });
}

async function loadOwnTask(id: string, agentId: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await ViewTask.findById(id).lean();
    if (!t) throw notFound('Tâche introuvable.');
    if (String(t.assigneeId) !== agentId) throw forbidden('Cette tâche ne vous est pas attribuée.', 'NOT_ASSIGNEE');
    return t;
}

export async function taskDetail(id: string, agent: { id: string }, supervisor: boolean) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await ViewTask.findById(id).lean();
    if (!t) throw notFound('Tâche introuvable.');
    if (!supervisor && String(t.assigneeId) !== agent.id) throw forbidden('Cette tâche ne vous est pas attribuée.', 'NOT_ASSIGNEE');
    const proof = await getProof(t.sourceId);
    const hist = await AssignmentHistory.find({ taskId: t._id }).sort({ at: 1 }).limit(100).lean();
    return { task: t, proof, history: hist };
}

export async function startTask(id: string, agent: { id: string }) {
    await loadOwnTask(id, agent.id);
    const now = new Date();
    const t = await ViewTask.findOneAndUpdate(
        { _id: id, assigneeId: new Types.ObjectId(agent.id), state: 'assigned' },
        { $set: { state: 'in_progress', startedAt: now, lastActivityAt: now }, $inc: { version: 1 } }, { new: true },
    ).lean();
    if (!t) {
        const cur = await ViewTask.findById(id).lean();
        if (cur?.state === 'in_progress') return cur;
        throw conflict('Cette tâche ne peut plus être commencée.', 'STATE_CHANGED');
    }
    return t;
}

export async function touchTask(id: string, agent: { id: string }) {
    const r = await ViewTask.updateOne(
        { _id: id, assigneeId: new Types.ObjectId(agent.id), state: { $in: ACTIVE_VIEW_STATES } },
        { $set: { lastActivityAt: new Date(), idleAlertedAt: null } },
    );
    await Agent.updateOne({ _id: agent.id }, { $set: { 'views.lastSeenAt': new Date() } });
    return { ok: r.matchedCount === 1 };
}

export interface DecisionInput { decision?: unknown; observedViews?: unknown; reason?: unknown; ban?: unknown; version?: unknown }

const DECISION_ALIASES: Record<string, string> = { review: 'to_review', technical_error: 'tech_error' };

/**
 * Decision by the assigned verifier. approve/reject go to advertising-service
 * first (with the agent identity); the task is only closed once it accepted.
 * `to_review` hands the proof to a supervisor; `tech_error` puts it back in the queue.
 */
export async function decideTask(id: string, agent: { id: string; name: string; roles: string[] }, input: DecisionInput, canBan: boolean) {
    const t = await loadOwnTask(id, agent.id);
    if (!ACTIVE_VIEW_STATES.includes(t.state as any)) throw conflict('Cette tâche est déjà traitée.', 'STATE_CHANGED');
    if (input.version !== undefined && input.version !== null && Number(input.version) !== t.version) {
        throw conflict('La tâche a changé entre-temps. Rechargez.', 'STATE_CHANGED');
    }
    const rawDecision = String(input.decision || '');
    const decision = DECISION_ALIASES[rawDecision] ?? rawDecision;
    const reason = str(input.reason, 1000);
    const now = new Date();

    if (decision === 'to_review' || decision === 'tech_error') {
        if (!reason) throw badRequest('Indiquez un motif.', 'REASON_REQUIRED');
        const next = decision === 'to_review' ? 'to_review' : 'available';
        const r = await ViewTask.updateOne(
            { _id: t._id, assigneeId: t.assigneeId, state: { $in: ACTIVE_VIEW_STATES }, version: t.version },
            {
                $set: {
                    state: next, ...(next === 'available' ? { assigneeId: null, assignedAt: null, startedAt: null } : {}),
                    decision: next === 'to_review' ? { decision, reason, at: now, by: agent.id, byName: agent.name } : null,
                },
                $inc: { version: 1, ...(next === 'available' ? { requeueCount: 1 } : {}) },
            },
        );
        if (r.modifiedCount !== 1) throw conflict('La tâche a changé entre-temps.', 'STATE_CHANGED');
        await history(t, decision === 'to_review' ? 'decision' : 'release', agent.id, null, agent.id, `${decision}: ${reason}`);
        if (decision === 'to_review') {
            await notifyAgents({ role: 'views_supervisor', kind: 'views.to_review', title: 'Preuve à revoir', body: `${agent.name} demande une seconde vérification.`, link: `/views/tasks/${t._id}`, dedupKey: `toreview:${t._id}` });
        }
        return ViewTask.findById(t._id).lean();
    }

    if (decision !== 'approve' && decision !== 'reject') throw badRequest('Décision inconnue.', 'BAD_DECISION');
    let observedViews: number | undefined;
    if (decision === 'approve') {
        if (input.observedViews === undefined || input.observedViews === null || input.observedViews === '') throw badRequest('Indiquez le nombre de vues observé.', 'VIEWS_REQUIRED');
        observedViews = Number(input.observedViews);
        if (!Number.isInteger(observedViews) || observedViews < 0 || observedViews > 1_000_000) throw badRequest('Nombre de vues invalide.', 'BAD_VIEWS');
    }
    if (decision === 'reject' && !reason) throw badRequest('Le motif du refus est obligatoire.', 'REASON_REQUIRED');
    const ban = input.ban === true;
    if (ban && !canBan) throw forbidden('Seul un superviseur peut bannir.', 'BAN_FORBIDDEN');

    const role = agent.roles.includes('views_supervisor') ? 'views_supervisor' : agent.roles.includes('support_admin') ? 'support_admin' : 'verifier';
    const res = await decideProof(t.sourceId, {
        decision, observedViews, reason: reason ?? undefined, ban: ban || undefined, actor: { agentId: agent.id, name: agent.name, role },
    });
    if (!res.ok && !res.alreadyDecided) throw badRequest(res.message || 'Décision refusée par le service publicité.', res.code || 'DECISION_REFUSED');

    const qaPercent = await getSetting<number>('views.qaSamplePercent');
    const sampled = !res.alreadyDecided && Math.random() * 100 < qaPercent;
    const finalState = res.alreadyDecided ? 'closed' : decision === 'approve' ? 'approved' : 'rejected';
    await ViewTask.updateOne(
        { _id: t._id },
        {
            $set: {
                state: finalState,
                decision: { decision: res.alreadyDecided ? 'already_decided' : decision, observedViews: observedViews ?? null, reason, ban, at: now, by: agent.id, byName: agent.name },
                qa: sampled ? { sampled: true, reviewedBy: null, verdict: null, note: null, at: null } : null,
            },
            $inc: { version: 1 },
        },
    );
    await history(t, 'decision', agent.id, null, agent.id, res.alreadyDecided ? 'already decided elsewhere' : decision);
    return { task: await ViewTask.findById(t._id).lean(), alreadyDecided: res.alreadyDecided };
}

/** Supervisor: assign (or reassign) a task to a verifier, with a reason. Never silent. */
export async function assignTask(id: string, by: { id: string; name: string }, toAgentId: unknown, reason: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const why = str(reason, 500);
    if (!why) throw badRequest('Le motif est obligatoire.', 'REASON_REQUIRED');
    if (typeof toAgentId !== 'string' || !Types.ObjectId.isValid(toAgentId)) throw badRequest('Vérificateur inconnu.', 'BAD_AGENT');
    const target = await Agent.findOne({ _id: toAgentId, status: 'active', roles: { $in: ['verifier', 'views_supervisor'] } }, { name: 1 }).lean();
    if (!target) throw badRequest('Vérificateur inconnu ou inactif.', 'BAD_AGENT');
    const t = await ViewTask.findById(id).lean();
    if (!t) throw notFound('Tâche introuvable.');
    if (!['available', 'assigned', 'in_progress', 'to_review'].includes(t.state)) throw conflict('Cette tâche est déjà traitée.', 'STATE_CHANGED');
    const now = new Date();
    const r = await ViewTask.updateOne(
        { _id: t._id, version: t.version, state: t.state },
        { $set: { state: 'assigned', assigneeId: target._id, assignedAt: now, startedAt: null, lastActivityAt: now, idleAlertedAt: null }, $inc: { version: 1 } },
    );
    if (r.modifiedCount !== 1) throw conflict('La tâche a changé entre-temps. Rechargez.', 'STATE_CHANGED');
    await history(t, 'manual', t.assigneeId ? String(t.assigneeId) : null, String(target._id), by.id, why);
    await notifyAgents({ agentId: String(target._id), kind: 'views.assigned', title: 'Preuve attribuée', body: `${by.name} vous a attribué une preuve.`, link: `/views/tasks/${t._id}` });
    if (t.assigneeId && String(t.assigneeId) !== String(target._id)) {
        await notifyAgents({ agentId: String(t.assigneeId), kind: 'views.reassigned', title: 'Preuve réattribuée', body: `Motif : ${why}`, link: '/views' });
    }
    return { before: t.assigneeId ? String(t.assigneeId) : null, after: String(target._id) };
}

/** Supervisor: put a task back in the queue. */
export async function releaseTask(id: string, by: { id: string }, reason: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const why = str(reason, 500);
    if (!why) throw badRequest('Le motif est obligatoire.', 'REASON_REQUIRED');
    const t = await ViewTask.findById(id).lean();
    if (!t) throw notFound('Tâche introuvable.');
    const r = await ViewTask.updateOne(
        { _id: t._id, version: t.version, state: { $in: [...ACTIVE_VIEW_STATES, 'to_review'] } },
        { $set: { state: 'available', assigneeId: null, assignedAt: null, startedAt: null, idleAlertedAt: null }, $inc: { version: 1, requeueCount: 1 } },
    );
    if (r.modifiedCount !== 1) throw conflict('La tâche a changé entre-temps. Rechargez.', 'STATE_CHANGED');
    await history(t, 'release', t.assigneeId ? String(t.assigneeId) : null, null, by.id, why);
    return { ok: true };
}

/**
 * QA verdict on a sampled decision: confirmed, or overturned/corrected (the
 * correction is recorded and traced; changing the proof's state in
 * advertising-service stays a supervisor action there).
 */
export async function qaReview(id: string, by: { id: string }, verdictIn: unknown, note: unknown, correction?: { decision?: unknown; observedViews?: unknown }) {
    const verdict = verdictIn === 'corrected' ? 'overturned' : verdictIn;
    if (verdict !== 'confirmed' && verdict !== 'overturned') throw badRequest('Verdict inconnu.', 'BAD_VERDICT');
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const corr = verdict === 'overturned' && correction
        ? { decision: typeof correction.decision === 'string' ? (DECISION_ALIASES[correction.decision] ?? correction.decision) : null, observedViews: Number.isInteger(correction.observedViews) ? correction.observedViews : null }
        : null;
    const r = await ViewTask.findOneAndUpdate(
        { _id: id, 'qa.sampled': true, 'qa.verdict': null },
        { $set: { 'qa.reviewedBy': by.id, 'qa.verdict': verdict, 'qa.note': str(note, 1000), 'qa.at': new Date(), 'qa.correction': corr } }, { new: true },
    ).lean();
    if (!r) throw conflict('Cette tâche n’est pas en attente de contrôle qualité.', 'NOT_SAMPLED');
    return r;
}

export async function setAvailability(agentId: string, available: boolean) {
    await Agent.updateOne({ _id: agentId }, { $set: { 'views.available': available, 'views.lastSeenAt': new Date() } });
    return { available };
}

export async function listTasks(q: Record<string, unknown>) {
    const filter: FilterQuery<IViewTask> = {};
    if (typeof q.state === 'string') filter.state = q.state;
    if (typeof q.assignee === 'string' && Types.ObjectId.isValid(q.assignee)) filter.assigneeId = new Types.ObjectId(q.assignee);
    if (q.qa === 'pending') { filter['qa.sampled'] = true; filter['qa.verdict'] = null; }
    const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(q.limit || '50'), 10) || 50));
    const [items, total, counts] = await Promise.all([
        ViewTask.find(filter).sort({ submittedAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        ViewTask.countDocuments(filter),
        ViewTask.aggregate([{ $group: { _id: '$state', n: { $sum: 1 } } }]),
    ]);
    return { items, total, page, limit, counts: Object.fromEntries(counts.map((c: any) => [c._id, c.n])) };
}

export async function agentStats(from: Date, to: Date) {
    const decided = await ViewTask.aggregate([
        { $match: { 'decision.at': { $gte: from, $lt: to }, 'decision.decision': { $in: ['approve', 'reject'] } } },
        {
            $group: {
                _id: '$decision.by', name: { $last: '$decision.byName' },
                approved: { $sum: { $cond: [{ $eq: ['$decision.decision', 'approve'] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ['$decision.decision', 'reject'] }, 1, 0] } },
                avgHandleMs: { $avg: { $subtract: ['$decision.at', { $ifNull: ['$startedAt', '$assignedAt'] }] } },
                qaReviewed: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$qa.verdict', null] }, null] }, 1, 0] } },
                qaOverturned: { $sum: { $cond: [{ $eq: ['$qa.verdict', 'overturned'] }, 1, 0] } },
            },
        },
    ]);
    const hist = await AssignmentHistory.aggregate([
        { $match: { at: { $gte: from, $lt: to } } },
        { $group: { _id: { to: '$to', kind: '$kind' }, n: { $sum: 1 } } },
    ]);
    const received: Record<string, number> = {};
    const reassignedAway: Record<string, number> = {};
    for (const h of hist) {
        if (h._id.to && ['claim', 'auto', 'manual'].includes(h._id.kind)) received[h._id.to] = (received[h._id.to] ?? 0) + h.n;
    }
    const moves = await AssignmentHistory.aggregate([
        { $match: { at: { $gte: from, $lt: to }, kind: { $in: ['manual', 'requeue', 'release'] }, from: { $ne: null } } },
        { $group: { _id: '$from', n: { $sum: 1 } } },
    ]);
    for (const m of moves) reassignedAway[m._id] = m.n;
    const inProgress = await ViewTask.aggregate([
        { $match: { state: { $in: ACTIVE_VIEW_STATES } } }, { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
    ]);
    const active: Record<string, number> = Object.fromEntries(inProgress.map((x: any) => [String(x._id), x.n]));
    const ids = new Set<string>([...decided.map((d: any) => String(d._id)), ...Object.keys(received), ...Object.keys(active)]);
    const agents = await Agent.find({ _id: { $in: [...ids].filter((i) => Types.ObjectId.isValid(i)) } }, { name: 1 }).lean();
    const names = Object.fromEntries(agents.map((a) => [String(a._id), a.name]));
    return [...ids].map((id) => {
        const d: any = decided.find((x: any) => String(x._id) === id) ?? {};
        return {
            agentId: id, name: names[id] ?? d.name ?? null, received: received[id] ?? 0, inProgress: active[id] ?? 0,
            approved: d.approved ?? 0, rejected: d.rejected ?? 0, reassigned: reassignedAway[id] ?? 0,
            avgHandleSeconds: d.avgHandleMs ? Math.round(d.avgHandleMs / 1000) : null,
            qaReviewed: d.qaReviewed ?? 0, errorRate: d.qaReviewed ? (d.qaOverturned ?? 0) / d.qaReviewed : null,
        };
    });
}

// ---------- Jobs ----------

/** Assigned but never started after N minutes: back to the queue (with history). */
export async function requeueUnstarted(): Promise<number> {
    const minutes = await getSetting<number>('views.unstartedRequeueMinutes');
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const stale = await ViewTask.find({ state: 'assigned', startedAt: null, assignedAt: { $lte: cutoff } }).limit(500).lean();
    let n = 0;
    for (const t of stale) {
        const r = await ViewTask.updateOne(
            { _id: t._id, state: 'assigned', version: t.version },
            { $set: { state: 'available', assigneeId: null, assignedAt: null }, $inc: { version: 1, requeueCount: 1 } },
        );
        if (r.modifiedCount !== 1) continue;
        n++;
        await history(t, 'requeue', t.assigneeId ? String(t.assigneeId) : null, null, 'system', `not started after ${minutes} min`);
        if (t.assigneeId) await notifyAgents({ agentId: String(t.assigneeId), kind: 'views.requeued', title: 'Preuve remise en file', body: `Non commencée après ${minutes} minutes.`, link: '/views' });
    }
    return n;
}

/** Started but idle: alert the agent and the supervisors. Never reassigned silently. */
export async function alertIdle(): Promise<number> {
    const minutes = await getSetting<number>('views.idleAlertMinutes');
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const idle = await ViewTask.find({ state: 'in_progress', lastActivityAt: { $lte: cutoff }, idleAlertedAt: null }).limit(500).lean();
    let n = 0;
    for (const t of idle) {
        const r = await ViewTask.updateOne({ _id: t._id, idleAlertedAt: null, state: 'in_progress' }, { $set: { idleAlertedAt: new Date() } });
        if (r.modifiedCount !== 1) continue;
        n++;
        const agent = t.assigneeId ? await Agent.findById(t.assigneeId, { name: 1 }).lean() : null;
        await notifyAgents({ agentId: t.assigneeId ? String(t.assigneeId) : undefined, kind: 'views.idle', title: 'Tâche inactive', body: `Aucune activité depuis ${minutes} minutes.`, link: `/views/tasks/${t._id}`, dedupKey: `idle:${t._id}:agent:${t.version}` });
        await notifyAgents({ role: 'views_supervisor', kind: 'views.idle', title: 'Vérificateur inactif', body: `${agent?.name ?? 'Un vérificateur'} : aucune activité depuis ${minutes} minutes sur une preuve.`, link: `/views/tasks/${t._id}`, dedupKey: `idle:${t._id}:sup:${t.version}` });
    }
    return n;
}

/**
 * Push distribution for round_robin / load: available verifiers without a task
 * get the oldest proofs, least recently served first (round robin) or least
 * busy today first (load). Off in manual mode or with the kill switch.
 */
export async function dispatch(): Promise<number> {
    const mode = await getSetting<string>('views.assignmentMode');
    if (mode === 'manual' || (await isKillSwitchOn('autoAssignment'))) return 0;
    const seenSince = new Date(Date.now() - 5 * 60_000);
    const candidates = await Agent.find({ status: 'active', roles: 'verifier', 'views.available': true, 'views.lastSeenAt': { $gte: seenSince } }, { name: 1, views: 1 }).lean();
    if (!candidates.length) return 0;
    const busy = new Set((await ViewTask.distinct('assigneeId', { state: { $in: ACTIVE_VIEW_STATES } })).map(String));
    let free = candidates.filter((a) => !busy.has(String(a._id)));
    if (mode === 'load') {
        const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
        const counts = await AssignmentHistory.aggregate([{ $match: { at: { $gte: dayStart }, kind: { $in: ['claim', 'auto', 'manual'] } } }, { $group: { _id: '$to', n: { $sum: 1 } } }]);
        const load = Object.fromEntries(counts.map((c: any) => [String(c._id), c.n]));
        free = free.sort((a, b) => (load[String(a._id)] ?? 0) - (load[String(b._id)] ?? 0));
    } else {
        free = free.sort((a, b) => (a.views?.lastAssignedAt?.getTime() ?? 0) - (b.views?.lastAssignedAt?.getTime() ?? 0));
    }
    let n = 0;
    for (const a of free) {
        const agentId = String(a._id);
        const got = await withLockWait(`views:claim:${agentId}`, 10_000, 2_000, async () => {
            if (await ViewTask.exists({ assigneeId: a._id, state: { $in: ACTIVE_VIEW_STATES } })) return false;
            const now = new Date();
            try {
                const task = await ViewTask.findOneAndUpdate(
                    { state: 'available' },
                    { $set: { state: 'assigned', assigneeId: a._id, assignedAt: now, startedAt: null, lastActivityAt: now, idleAlertedAt: null }, $inc: { version: 1 } },
                    { sort: { submittedAt: 1 }, new: true },
                ).lean();
                if (!task) return null;
                await history(task, 'auto', null, agentId, 'system', mode);
                await Agent.updateOne({ _id: a._id }, { $set: { 'views.lastAssignedAt': now } });
                return true;
            } catch (err: any) {
                if (err?.code === 11000) return false;
                throw err;
            }
        }).catch(() => false);
        if (got === null) break; // queue empty
        if (got) n++;
    }
    return n;
}

/** Every 5 minutes: pull pending proofs from advertising-service in case a push was lost. */
export async function catchUpFromAdvertising(): Promise<number> {
    const proofs = await listPendingProofs(undefined, 200);
    let created = 0;
    for (const p of proofs) {
        const sourceId = String(p.id ?? p._id ?? '');
        if (!sourceId) continue;
        const r = await upsertViewTask({ ...p, sourceId });
        if (r.created) created++;
    }
    if (created) log.info('view tasks caught up', { created });
    return created;
}
