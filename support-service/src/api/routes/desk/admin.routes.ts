import { Router } from 'express';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission, requireReauth } from '../../middleware/agent-auth';
import * as admin from '../../../services/agent-admin.service';
import { audit, verifyAuditChain } from '../../../services/audit.service';
import { getAllSettings, setSetting } from '../../../services/settings.service';
import { AuditLog } from '../../../database/models/audit-log.model';
import { Setting } from '../../../database/models/setting.model';
import { revokeAllSessions } from '../../../services/auth/session.service';
import { badRequest } from '../../../utils/errors';
import { agentNames, page, presentAudit } from '../../presenters';
import { periodEnd } from '../../../utils/dates';

const router = Router();
const reasonOf = (req: any) => (typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 1000) : null);

// ---- agents ----
router.get('/agents', requirePermission('agents.manage'), ah(async (_req, res) => {
    res.json({ success: true, data: await admin.listAgents() });
}));

router.get('/roles', requirePermission('agents.manage'), (_req, res) => {
    res.json({ success: true, data: admin.roleList() });
});

/** → `{ agent, activationUrl }`: the one-time link is shown once to the admin (or emailed with delivery:'email'). */
router.post('/agents', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.createAgent(req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.created', target: { type: 'agent', id: r.agent.id }, after: { email: r.agent.email, roles: r.agent.roles, delivery: r.emailed ? 'email' : 'link' }, ...reqCtx(req) });
    res.status(201).json({ success: true, data: r });
}));

router.put('/agents/:id/roles', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.updateRoles(req.params.id, req.body?.roles, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.roles_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: await admin.getAgentView(req.params.id) });
}));

/** Country team: `{ countries: ['CM', 'BJ'] }`, [] = every country. */
router.put('/agents/:id/countries', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.setCountries(req.params.id, req.body?.countries);
    await audit({ actor: actorOf(req), action: 'agent.countries_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: await admin.getAgentView(req.params.id) });
}));

/** The agent's own SBC member account (Phase 5 conflict rule): `{ userId }`, null = none. */
router.put('/agents/:id/member-account', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const r = await admin.setMemberAccount(req.params.id, req.body?.userId ?? null);
    await audit({ actor: actorOf(req), action: 'agent.member_account_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: await admin.getAgentView(req.params.id) });
}));

const statusRoute = (status: 'active' | 'disabled') => ah(async (req, res) => {
    const r = await admin.setStatus(req.params.id, status, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'agent.status_changed', target: { type: 'agent', id: req.params.id }, before: r.before, after: r.after, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: await admin.getAgentView(req.params.id) });
});
router.post('/agents/:id/disable', requirePermission('agents.manage'), requireReauth, statusRoute('disabled'));
router.post('/agents/:id/enable', requirePermission('agents.manage'), requireReauth, statusRoute('active'));

/** New activation link: wipes password, TOTP and backup codes, ends every session. */
const resetRoute = ah(async (req, res) => {
    const r = await admin.resetAgent(req.params.id, agentOf(req).id, req.body?.delivery);
    await audit({ actor: actorOf(req), action: 'agent.reset', target: { type: 'agent', id: req.params.id }, after: { delivery: r.emailed ? 'email' : 'link' }, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: r });
});
router.post('/agents/:id/activation-link', requirePermission('agents.manage'), requireReauth, resetRoute);
router.post('/agents/:id/reset', requirePermission('agents.manage'), requireReauth, resetRoute);

router.get('/agents/:id/sessions', requirePermission('agents.manage'), ah(async (req, res) => {
    res.json({ success: true, data: await admin.listSessions(req.params.id) });
}));

router.post('/agents/:id/revoke-sessions', requirePermission('agents.manage'), requireReauth, ah(async (req, res) => {
    const n = await revokeAllSessions(req.params.id, 'admin_revoke');
    await audit({ actor: actorOf(req), action: 'agent.sessions_revoked', target: { type: 'agent', id: req.params.id }, after: { revoked: n }, ...reqCtx(req) });
    res.json({ success: true, data: { revoked: n } });
}));

// ---- settings ----
async function settingEntries() {
    const [all, docs] = await Promise.all([getAllSettings(), Setting.find({}).lean()]);
    const byKey = Object.fromEntries(docs.map((d) => [d.key, d]));
    const names = await agentNames(docs.map((d) => d.updatedBy));
    return all.map((s) => ({
        ...s, updatedAt: byKey[s.key]?.updatedAt ?? null,
        updatedBy: byKey[s.key]?.updatedBy ? names[byKey[s.key].updatedBy as string] ?? { id: byKey[s.key].updatedBy, name: '—' } : null,
    }));
}

router.get('/settings', requirePermission('settings.manage'), ah(async (_req, res) => {
    res.json({ success: true, data: await settingEntries() });
}));

/** `{ value, reason }` → the saved SettingEntry. */
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
    await audit({ actor: actorOf(req), action: 'settings.changed', target: { type: 'setting', id: req.params.key }, before: r.before, after: r.after, reason: reasonOf(req), ...reqCtx(req) });
    res.json({ success: true, data: (await settingEntries()).find((s) => s.key === req.params.key) });
}));

// ---- audit (read only: there is no write route) ----
router.get('/audit', requirePermission('audit.read'), ah(async (req, res) => {
    const q = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (q.action) filter.action = q.action;
    const actor = String(q.actor || q.actorId || '').trim();
    // "Agent (nom ou id)": an agent id matches exactly; any other text matches an id
    // (system actors such as "seed-kb") or, ignoring case, part of the name.
    if (actor) {
        const esc = actor.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = /^[a-f0-9]{24}$/i.test(actor) ? [{ 'actor.id': actor }] : [{ 'actor.id': actor }, { 'actor.name': { $regex: esc, $options: 'i' } }];
    }
    if (q.objectId || q.targetId) filter['target.id'] = q.objectId || q.targetId;
    if (q.result) filter.result = q.result;
    const range: Record<string, Date> = {};
    if (q.from && !Number.isNaN(Date.parse(q.from))) range.$gte = new Date(q.from);
    if (q.to && !Number.isNaN(periodEnd(q.to).getTime())) range.$lte = periodEnd(q.to);
    if (Object.keys(range).length) filter.at = range;
    const p = page(q, 50);
    const [items, total] = await Promise.all([
        AuditLog.find(filter).sort({ seq: -1 }).skip((p.page - 1) * p.limit).limit(p.limit).lean(),
        AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items: items.map(presentAudit), total, ...p } });
}));

const verifyRoute = ah(async (req, res) => {
    const r = await verifyAuditChain();
    const out = { ok: r.ok, checked: r.count, firstBrokenSeq: r.firstBadSeq ?? null, reason: r.reason ?? null, verifiedAt: new Date().toISOString() };
    await audit({ actor: actorOf(req), action: 'audit.verified', after: out, ...reqCtx(req) });
    res.json({ success: true, data: out });
});
router.post('/audit/verify', requirePermission('audit.read'), verifyRoute);
router.get('/audit/verify', requirePermission('audit.read'), verifyRoute);

export default router;
