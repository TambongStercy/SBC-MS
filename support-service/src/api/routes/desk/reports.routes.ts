import { Router } from 'express';
import { Types } from 'mongoose';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission } from '../../middleware/agent-auth';
import { agentReport, agentReportCsv, exportCsv, parsePeriod, summary } from '../../../services/report.service';
import { audit } from '../../../services/audit.service';
import { AgentNotification } from '../../../database/models/agent-notification.model';
import { Agent } from '../../../database/models/agent.model';
import { CASE_STATUSES, CASE_TYPES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, VIEW_TASK_STATES } from '../../../config/constants';
import { ROLE_LABELS } from '../../../config/permissions';

const router = Router();

router.get('/reports/summary', requirePermission('reports.read'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as any);
    res.json({ success: true, data: await summary(from, to) });
}));

/** CSV export, gated by `export` and audited. */
router.get('/reports/export', requirePermission('reports.read', 'export'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as any);
    const r = await exportCsv(req.query.type, from, to);
    await audit({ actor: actorOf(req), action: 'export', target: { type: 'export', id: String(req.query.type) }, meta: { from, to, rows: r.rows }, ...reqCtx(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`﻿${r.csv}`);
}));

router.get('/reports/agents', requirePermission('reports.read'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as any);
    res.json({ success: true, data: await agentReport(from, to, typeof req.query.agentId === 'string' ? req.query.agentId : undefined) });
}));

router.get('/reports/agents/export', requirePermission('reports.read', 'export'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as any);
    const r = await agentReport(from, to, typeof req.query.agentId === 'string' ? req.query.agentId : undefined);
    await audit({ actor: actorOf(req), action: 'export', target: { type: 'export', id: 'agents' }, meta: { from, to, rows: r.rows.length }, ...reqCtx(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sbc-support-agents-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`\uFEFF${agentReportCsv(r)}`);
}));

// ---- the desk bell ----
router.get('/notifications', ah(async (req, res) => {
    const a = agentOf(req);
    const items = await AgentNotification.find({ $or: [{ agentId: a.id }, { role: { $in: a.roles } }] }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: items.map((n) => ({ id: String(n._id), kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, read: n.readBy.includes(a.id) })) });
}));

router.post('/notifications/:id/read', ah(async (req, res) => {
    const a = agentOf(req);
    if (Types.ObjectId.isValid(req.params.id)) {
        await AgentNotification.updateOne({ _id: req.params.id, $or: [{ agentId: a.id }, { role: { $in: a.roles } }] }, { $addToSet: { readBy: a.id } });
    }
    res.json({ success: true });
}));

router.post('/notifications/read-all', ah(async (req, res) => {
    const a = agentOf(req);
    await AgentNotification.updateMany({ $or: [{ agentId: a.id }, { role: { $in: a.roles } }], readBy: { $ne: a.id } }, { $addToSet: { readBy: a.id } });
    res.json({ success: true });
}));

/** Fixed lists for the desk UI (categories, statuses, roles) and the active agents to assign to. */
router.get('/meta', ah(async (_req, res) => {
    const agents = await Agent.find({ status: 'active' }, { name: 1, roles: 1 }).sort({ name: 1 }).lean();
    res.json({
        success: true,
        data: {
            ticketCategories: TICKET_CATEGORIES, ticketStatuses: TICKET_STATUSES, ticketPriorities: TICKET_PRIORITIES,
            caseTypes: CASE_TYPES, caseStatuses: CASE_STATUSES, viewTaskStates: VIEW_TASK_STATES, roles: ROLE_LABELS,
            agents: agents.map((x) => ({ id: String(x._id), name: x.name, roles: x.roles })),
        },
    });
}));

export default router;
