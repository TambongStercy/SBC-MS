import { Router } from 'express';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission, requireReauth } from '../../middleware/agent-auth';
import * as admin from '../../../services/agent-admin.service';
import { audit, verifyAuditChain } from '../../../services/audit.service';
import { getAllSettings, setSetting } from '../../../services/settings.service';
import { AuditLog } from '../../../database/models/audit-log.model';
import { revokeAllSessions } from '../../../services/auth/session.service';
import { badRequest } from '../../../utils/errors';

const router = Router();

// ---- agents ----
router.get('/agents', requirePermission('agents.manage'), ah(async (_req, res) => {
    res.json({ success: true, data: { agents: await admin.listAgents(), roles: admin.roleList() } });
}));

router.post('/agents', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.createAgent(req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.created', target: { type: 'agent', id: r.agent.id }, after: { email: r.agent.email, roles: r.agent.roles, delivery: r.emailed ? 'email' : 'manual' }, ...reqCtx(req) });
    res.status(201).json({ success: true, data: r });
}));

router.put('/agents/:id/roles', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.updateRoles(req.params.id, req.body?.roles, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.roles_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: req.body?.reason ?? null, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

router.post('/agents/:id/status', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.setStatus(req.params.id, req.body?.status, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.status_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: req.body?.reason ?? null, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

router.post('/agents/:id/reset', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.resetAgent(req.params.id, agentOf(req).id, req.body?.delivery);
    await audit({ actor: actorOf(req), action: 'agent.reset', target: { type: 'agent', id: req.params.id }, after: { delivery: r.emailed ? 'email' : 'manual' }, reason: req.body?.reason ?? null, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

router.get('/agents/:id/sessions', requirePermission('agents.manage'), ah(async (req, res) => {
    res.json({ success: true, data: await admin.listSessions(req.params.id) });
}));

router.post('/agents/:id/revoke-sessions', requirePermission('agents.manage'), ah(async (req, res) => {
    const n = await revokeAllSessions(req.params.id, 'admin_revoke');
    await audit({ actor: actorOf(req), action: 'agent.sessions_revoked', target: { type: 'agent', id: req.params.id }, after: { revoked: n }, ...reqCtx(req) });
    res.json({ success: true, data: { revoked: n } });
}));

// ---- settings ----
router.get('/settings', requirePermission('settings.manage'), ah(async (_req, res) => {
    res.json({ success: true, data: await getAllSettings() });
}));

router.put('/settings/:key', requirePermission('settings.manage'), requireReauth, ah(async (req, res) => {
    let r;
    try {
        r = await setSetting(req.params.key, req.body?.value, agentOf(req).id);
    } catch (err) {
        const m = (err as Error).message;
        if (m === 'UNKNOWN_SETTING') throw badRequest('Réglage inconnu.', 'UNKNOWN_SETTING');
        if (m === 'INVALID_SETTING') throw badRequest('Valeur invalide pour ce réglage.', 'INVALID_SETTING');
        throw err;
    }
    await audit({ actor: actorOf(req), action: 'settings.changed', target: { type: 'setting', id: req.params.key }, before: r.before, after: r.after, reason: req.body?.reason ?? null, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

// ---- audit (read only: there is no write route) ----
router.get('/audit', requirePermission('audit.read'), ah(async (req, res) => {
    const q = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (q.action) filter.action = q.action;
    if (q.actorId) filter['actor.id'] = q.actorId;
    if (q.targetId) filter['target.id'] = q.targetId;
    if (q.result) filter.result = q.result;
    if (q.from || q.to) filter.at = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lt: new Date(q.to) } : {}) };
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '50', 10) || 50));
    const [items, total] = await Promise.all([
        AuditLog.find(filter).sort({ seq: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, total, page, limit } });
}));

router.get('/audit/verify', requirePermission('audit.read'), ah(async (req, res) => {
    const r = await verifyAuditChain();
    await audit({ actor: actorOf(req), action: 'audit.verified', after: r, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

export default router;
