import { Router } from 'express';
import { Types } from 'mongoose';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission } from '../../middleware/agent-auth';
import * as views from '../../../services/views.service';
import { audit } from '../../../services/audit.service';
import { hasPermission } from '../../../config/permissions';
import { ACTIVE_VIEW_STATES, VIEW_TASK_STATES } from '../../../config/constants';
import { parsePeriod } from '../../../services/report.service';
import { getSetting, setSetting } from '../../../services/settings.service';
import { getProof } from '../../../services/clients/advertising.client';
import { ViewTask } from '../../../database/models/view-task.model';
import { Agent } from '../../../database/models/agent.model';
import { agentNames, presentProof, presentViewTask, presentViewTasks } from '../../presenters';
import { badRequest } from '../../../utils/errors';

const router = Router();

/** The proof from advertising-service; null (not an error) when it cannot be read. */
async function proofOf(sourceId: string) {
    try { return await getProof(sourceId); } catch { return null; }
}

/**
 * The supervisor's lists (to review, quality check) show each proof's campaign,
 * diffuseur, day and video: proofs are read from advertising for the first 50
 * tasks, 8 at a time; a proof that cannot be read leaves that row without it.
 */
async function tasksWithProofs(list: any[]) {
    const names = await agentNames(list.map((t) => t.assigneeId));
    const proofs: unknown[] = new Array(list.length).fill(undefined);
    const head = list.slice(0, 50);
    for (let i = 0; i < head.length; i += 8) {
        const batch = await Promise.all(head.slice(i, i + 8).map((t) => proofOf(t.sourceId)));
        batch.forEach((p, j) => { proofs[i + j] = p ?? undefined; });
    }
    return list.map((t, i) => presentViewTask(t, names, proofs[i]));
}

async function taskOut(t: any, withProof = false) {
    if (!t) return null;
    const names = await agentNames([t.assigneeId]);
    return presentViewTask(t, names, withProof ? await proofOf(t.sourceId) : undefined);
}

const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

// ---- verifier ----
router.get('/current', requirePermission('views.verify'), ah(async (req, res) => {
    const t = await ViewTask.findOne({ assigneeId: new Types.ObjectId(agentOf(req).id), state: { $in: ACTIVE_VIEW_STATES } }).sort({ assignedAt: 1 }).lean();
    res.json({ success: true, data: { task: await taskOut(t, true) } });
}));

/** "Tâche suivante": idempotent, a repeated call returns the same task. */
router.post('/next', requirePermission('views.verify'), ah(async (req, res) => {
    const r = await views.claimNextTask(agentOf(req));
    res.json({ success: true, data: { task: await taskOut(r.task, true), reason: r.reason ?? null } });
}));

router.post('/availability', requirePermission('views.verify'), ah(async (req, res) => {
    res.json({ success: true, data: await views.setAvailability(agentOf(req).id, req.body?.available === true) });
}));

router.get('/mine', requirePermission('views.verify'), ah(async (req, res) => {
    const me = new Types.ObjectId(agentOf(req).id);
    const [active, decided, self] = await Promise.all([
        ViewTask.find({ assigneeId: me, state: { $in: ACTIVE_VIEW_STATES } }).sort({ assignedAt: 1 }).lean(),
        ViewTask.find({ 'decision.by': String(me), 'decision.at': { $gte: dayStart() } }).sort({ 'decision.at': -1 }).limit(100).lean(),
        Agent.findById(me, { 'views.available': 1 }).lean(),
    ]);
    const approved = decided.filter((t) => t.decision?.decision === 'approve').length;
    const rejected = decided.filter((t) => t.decision?.decision === 'reject').length;
    res.json({ success: true, data: { items: await presentViewTasks([...active, ...decided]), today: { decided: approved + rejected, approved, rejected }, available: (self as any)?.views?.available === true } });
}));

router.get('/tasks/:id', ah(async (req, res, next) => {
    const roles = agentOf(req).roles;
    const supervisor = hasPermission(roles, 'views.supervise');
    if (!supervisor && !hasPermission(roles, 'views.verify')) return requirePermission('views.verify')(req, res, next);
    const d = await views.taskDetail(req.params.id, agentOf(req), supervisor);
    res.json({ success: true, data: { ...(await taskOut(d.task)), proof: presentProof(d.proof), history: d.history } });
}));

router.post('/tasks/:id/start', requirePermission('views.verify'), ah(async (req, res) => {
    res.json({ success: true, data: await taskOut(await views.startTask(req.params.id, agentOf(req)), true) });
}));

const heartbeat = ah(async (req, res) => {
    await views.touchTask(req.params.id, agentOf(req));
    res.status(204).end();
});
router.post('/tasks/:id/heartbeat', requirePermission('views.verify'), heartbeat);
router.post('/tasks/:id/activity', requirePermission('views.verify'), heartbeat);

/** `{ decision: approve|reject|review|technical_error, observedViews?, reason?, ban?, version }` → the task. */
router.post('/tasks/:id/decision', requirePermission('views.verify'), ah(async (req, res) => {
    const agent = agentOf(req);
    const r: any = await views.decideTask(req.params.id, agent, req.body ?? {}, hasPermission(agent.roles, 'views.supervise'));
    await audit({
        actor: actorOf(req), action: 'views.decision', target: { type: 'viewtask', id: req.params.id },
        after: { decision: req.body?.decision, observedViews: req.body?.observedViews ?? null, ban: req.body?.ban === true, alreadyDecided: Boolean(r?.alreadyDecided) },
        reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 1000) : null, ...reqCtx(req),
    });
    const task = r?.task ?? r;
    res.json({ success: true, data: { ...(await taskOut(task)), alreadyDecided: Boolean(r?.alreadyDecided) } });
}));

// ---- supervisor ----
router.get('/board', requirePermission('views.supervise'), ah(async (_req, res) => {
    const [countsRaw, active, verifiers, decidedToday] = await Promise.all([
        ViewTask.aggregate([{ $group: { _id: '$state', n: { $sum: 1 } } }]),
        ViewTask.find({ state: { $in: ACTIVE_VIEW_STATES } }).lean(),
        Agent.find({ status: 'active', roles: { $in: ['verifier', 'views_supervisor'] } }, { name: 1, views: 1 }).sort({ name: 1 }).lean(),
        ViewTask.aggregate([
            { $match: { 'decision.at': { $gte: dayStart() }, 'decision.decision': { $in: ['approve', 'reject'] } } },
            { $group: { _id: '$decision.by', approved: { $sum: { $cond: [{ $eq: ['$decision.decision', 'approve'] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ['$decision.decision', 'reject'] }, 1, 0] } } } },
        ]),
    ]);
    const counts = Object.fromEntries(countsRaw.map((c: any) => [c._id, c.n]));
    const [requeueMin, idleMin] = await Promise.all([getSetting<number>('views.unstartedRequeueMinutes'), getSetting<number>('views.idleAlertMinutes')]);
    const now = Date.now();
    const minutes = (d?: Date | null) => (d ? Math.floor((now - new Date(d).getTime()) / 60000) : 0);
    const byAgent = new Map(active.map((t) => [String(t.assigneeId), t]));
    const today = Object.fromEntries(decidedToday.map((d: any) => [d._id, d]));
    const alerts: any[] = [];
    const agents = verifiers.map((a) => {
        const t: any = byAgent.get(String(a._id));
        const idle = t ? minutes(t.state === 'assigned' ? t.assignedAt : t.lastActivityAt) : 0;
        if (t && t.state === 'assigned' && idle >= requeueMin) alerts.push({ taskId: String(t._id), agentId: String(a._id), agentName: a.name, idleMinutes: idle, kind: 'unstarted' });
        if (t && t.state === 'in_progress' && idle >= idleMin) alerts.push({ taskId: String(t._id), agentId: String(a._id), agentName: a.name, idleMinutes: idle, kind: 'idle' });
        const d = today[String(a._id)] ?? { approved: 0, rejected: 0 };
        return {
            id: String(a._id), name: a.name,
            online: Boolean(a.views?.available && a.views?.lastSeenAt && now - new Date(a.views.lastSeenAt).getTime() < 5 * 60_000),
            current: t ? { taskId: String(t._id), state: t.state, assignedAt: t.assignedAt, startedAt: t.startedAt ?? null, lastActivityAt: t.lastActivityAt ?? null, idleMinutes: idle } : null,
            todayDecided: d.approved + d.rejected, todayApproved: d.approved, todayRejected: d.rejected,
        };
    });
    res.json({
        success: true,
        data: { counts: { available: counts.available ?? 0, assigned: counts.assigned ?? 0, in_progress: counts.in_progress ?? 0, to_review: counts.to_review ?? 0 }, agents, alerts },
    });
}));

router.get('/tasks', requirePermission('views.supervise'), ah(async (req, res) => {
    const state = typeof req.query.state === 'string' && (VIEW_TASK_STATES as readonly string[]).includes(req.query.state) ? req.query.state : 'available';
    const list = await ViewTask.find({ state }).sort({ submittedAt: 1 }).limit(200).lean();
    res.json({ success: true, data: state === 'available' ? await presentViewTasks(list) : await tasksWithProofs(list) });
}));

router.get('/verifiers', requirePermission('views.supervise'), ah(async (_req, res) => {
    const list = await Agent.find({ status: 'active', roles: { $in: ['verifier', 'views_supervisor'] } }, { name: 1 }).sort({ name: 1 }).lean();
    res.json({ success: true, data: list.map((a) => ({ id: String(a._id), name: a.name })) });
}));

/** `{ agentId, reason }`; agentId null puts the task back in the queue. Never silent: reason required, history kept. */
const reassign = ah(async (req, res) => {
    const to = req.body?.agentId ?? null;
    if (to === null) {
        await views.releaseTask(req.params.id, agentOf(req), req.body?.reason);
        await audit({ actor: actorOf(req), action: 'views.released', target: { type: 'viewtask', id: req.params.id }, reason: req.body?.reason ?? null, ...reqCtx(req) });
    } else {
        const r = await views.assignTask(req.params.id, agentOf(req), to, req.body?.reason);
        await audit({ actor: actorOf(req), action: 'views.reassigned', target: { type: 'viewtask', id: req.params.id }, before: r.before, after: r.after, reason: req.body?.reason ?? null, ...reqCtx(req) });
    }
    res.json({ success: true, data: await taskOut(await ViewTask.findById(req.params.id).lean()) });
});
router.post('/tasks/:id/reassign', requirePermission('views.supervise'), reassign);
router.post('/tasks/:id/assign', requirePermission('views.supervise'), reassign);

const VIEW_SETTING_KEYS = ['assignmentMode', 'unstartedRequeueMinutes', 'idleAlertMinutes', 'qaSamplePercent'] as const;

async function viewSettings() {
    const out: Record<string, unknown> = {};
    for (const k of VIEW_SETTING_KEYS) out[k] = await getSetting(`views.${k}`);
    return out;
}

router.get('/settings', requirePermission('views.supervise'), ah(async (_req, res) => {
    res.json({ success: true, data: await viewSettings() });
}));

router.put('/settings', requirePermission('views.supervise'), ah(async (req, res) => {
    const body = req.body ?? {};
    for (const k of VIEW_SETTING_KEYS) {
        if (body[k] === undefined) continue;
        let r;
        try { r = await setSetting(`views.${k}`, body[k], agentOf(req).id); } catch { throw badRequest(`Valeur invalide : ${k}.`, 'INVALID_SETTING'); }
        if (JSON.stringify(r.before) !== JSON.stringify(r.after)) {
            await audit({ actor: actorOf(req), action: 'settings.changed', target: { type: 'setting', id: `views.${k}` }, before: r.before, after: r.after, ...reqCtx(req) });
        }
    }
    res.json({ success: true, data: await viewSettings() });
}));

router.get('/qa', requirePermission('views.supervise'), ah(async (_req, res) => {
    const list = await ViewTask.find({ 'qa.sampled': true }).sort({ 'decision.at': -1 }).limit(200).lean();
    const tasks = await tasksWithProofs(list);
    res.json({ success: true, data: tasks.map((task, i) => ({ task, verdict: list[i].qa?.verdict === 'overturned' ? 'corrected' : list[i].qa?.verdict ?? null })) });
}));

const qaVerdict = ah(async (req, res) => {
    const id = req.params.taskId ?? req.params.id;
    const b = req.body ?? {};
    const t = await views.qaReview(id, agentOf(req), b.verdict, b.reason ?? b.note, { decision: b.decision, observedViews: b.observedViews });
    await audit({ actor: actorOf(req), action: 'views.qa', target: { type: 'viewtask', id }, after: { verdict: b.verdict, decision: b.decision ?? null, observedViews: b.observedViews ?? null }, reason: b.reason ?? b.note ?? null, ...reqCtx(req) });
    res.json({ success: true, data: { task: await taskOut(t), verdict: t.qa?.verdict === 'overturned' ? 'corrected' : t.qa?.verdict } });
});
router.post('/qa/:taskId', requirePermission('views.supervise'), qaVerdict);
router.post('/tasks/:id/qa', requirePermission('views.supervise'), qaVerdict);

router.get('/stats', requirePermission('views.supervise'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as any);
    res.json({ success: true, data: await views.agentStats(from, to) });
}));

export default router;
