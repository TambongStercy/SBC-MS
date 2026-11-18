import { Router } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, assertPermission, reqCtx, requirePermission } from '../../middleware/agent-auth';
import * as tickets from '../../../services/ticket.service';
import { listTemplates, saveTemplate } from '../../../services/kb.service';
import { MAX_ATTACHMENT_BYTES, storeAttachment } from '../../../services/attachment.service';
import { storage } from '../../../services/storage.service';
import { audit } from '../../../services/audit.service';
import { hasPermission, permissionsFor } from '../../../config/permissions';
import { OPEN_TICKET_STATUSES, TICKET_CATEGORIES } from '../../../config/constants';
import { Attachment, ResponseTemplate, Ticket, TicketMessage } from '../../../database/models/ticket.model';
import { Agent } from '../../../database/models/agent.model';
import { agentNames, memberNames, presentEvents, presentMessage, presentTicket, presentTickets, storedStatus } from '../../presenters';
import { badRequest, notFound } from '../../../utils/errors';
import { deskRealtimeToken } from '../../../services/realtime.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
const me = (req: any) => { const a = agentOf(req); return { id: a.id, name: a.name }; };

async function ticketOut(id: string) {
    const t = await Ticket.findById(id).lean();
    if (!t) throw notFound('Ticket introuvable.');
    return presentTicket(t, await agentNames([t.assigneeId]), t.memberName ? {} : await memberNames([t.memberId]));
}

// Every filter of listDeskTickets except the free text `q`.
const TICKET_FILTERS = ['queue', 'status', 'priority', 'assignee', 'memberId', 'number', 'slaBreached', 'page', 'limit'] as const;

async function listTickets(filters: Record<string, unknown>, text: unknown, agentId: string) {
    const q: Record<string, unknown> = {};
    for (const k of TICKET_FILTERS) if (filters[k] !== undefined && filters[k] !== null && filters[k] !== '') q[k] = String(filters[k]);
    if (typeof text === 'string' && text.trim()) q.q = text;
    if (typeof q.status === 'string' && q.status !== 'active') q.status = storedStatus(q.status) ?? '__none__';
    const r = await tickets.listDeskTickets(q, agentId);
    return { ...r, items: await presentTickets(r.items) };
}

// Filters only: the free text is never read from a URL (see POST /tickets/search).
router.get('/tickets', requirePermission('tickets.read'), ah(async (req, res) => {
    res.json({ success: true, data: await listTickets(req.query as Record<string, unknown>, undefined, agentOf(req).id) });
}));

// POST, not GET: agents search tickets by a member's email, phone or name, and a
// query string ends up in the gateway and nginx access logs and the browser history.
router.post('/tickets/search', requirePermission('tickets.read'), ah(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json({ success: true, data: await listTickets(body, body.q, agentOf(req).id) });
}));

// Live updates: a listen-only LiveKit token for the desk room ({ enabled:false } without LiveKit).
router.get('/realtime/token', requirePermission('tickets.read'), ah(async (req, res) => {
    res.json({ success: true, data: await deskRealtimeToken(agentOf(req)) });
}));

router.get('/tickets/queues', requirePermission('tickets.read'), ah(async (_req, res) => {
    const counts = await Ticket.aggregate([{ $match: { status: { $in: OPEN_TICKET_STATUSES } } }, { $group: { _id: '$queue', n: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
    res.json({ success: true, data: TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label, open: by[c.key] ?? 0 })) });
}));

router.get('/tickets/assignees', requirePermission('tickets.read'), ah(async (_req, res) => {
    const agents = await Agent.find({ status: 'active' }, { name: 1, roles: 1 }).sort({ name: 1 }).lean();
    res.json({ success: true, data: agents.filter((a) => permissionsFor(a.roles).includes('tickets.reply')).map((a) => ({ id: String(a._id), name: a.name })) });
}));

router.get('/tickets/:id', requirePermission('tickets.read'), ah(async (req, res) => {
    const d = await tickets.getDeskTicket(req.params.id);
    const names = await agentNames([d.ticket.assigneeId]);
    const raw = await TicketMessage.find({ ticketId: d.ticket._id }).sort({ createdAt: 1 }).limit(500).lean();
    res.json({
        success: true,
        data: { ticket: presentTicket(d.ticket, names, d.ticket.memberName ? {} : await memberNames([d.ticket.memberId])), messages: await Promise.all(raw.map(presentMessage)), events: await presentEvents(d.events) },
    });
}));

/** The member's session replay (OpenReplay); every opening is audited, as a replay shows the member's screen. */
router.post('/tickets/:id/replay', requirePermission('tickets.read'), ah(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const t = await Ticket.findById(req.params.id, { replay: 1, memberId: 1 }).lean();
    if (!t?.replay?.url) throw notFound('Pas d’enregistrement de session pour ce ticket.');
    await audit({ actor: actorOf(req), action: 'ticket.replay.opened', target: { type: 'ticket', id: req.params.id }, after: { memberId: t.memberId, sessionId: t.replay.sessionId }, ...reqCtx(req) });
    res.json({ success: true, data: { url: t.replay.url } });
}));

router.get('/tickets/:id/attachments/:attachmentId/url', requirePermission('tickets.read'), ah(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id) || !Types.ObjectId.isValid(req.params.attachmentId)) throw notFound();
    const a = await Attachment.findOne({ _id: req.params.attachmentId, ticketId: req.params.id }).lean();
    if (!a) throw notFound('Pièce jointe introuvable.');
    const url = await storage().presignGet(a.key, a.filename);
    const hour = 3600_000;
    res.json({ success: true, data: { url, expiresAt: new Date(Math.floor(Date.now() / hour) * hour + 2 * hour).toISOString() } });
}));

/** Agent reply `{ body, internal, attachmentIds?, status? }` → the created message. */
router.post('/tickets/:id/messages', requirePermission('tickets.reply'), ah(async (req, res) => {
    const b = req.body ?? {};
    const status = b.status !== undefined ? storedStatus(b.status) : undefined;
    if (b.status !== undefined && !status) throw badRequest('Statut inconnu.', 'BAD_STATUS');
    const m = await tickets.deskReply(req.params.id, me(req), { body: b.body, internal: b.internal, attachmentIds: b.attachmentIds, status });
    res.status(201).json({ success: true, data: await presentMessage(m) });
}));

router.post('/tickets/:id/status', requirePermission('tickets.reply'), ah(async (req, res) => {
    const status = storedStatus(req.body?.status);
    if (!status) throw badRequest('Statut inconnu.', 'BAD_STATUS');
    const note = typeof (req.body?.reason ?? req.body?.note) === 'string' ? String(req.body.reason ?? req.body.note).slice(0, 500) : undefined;
    const r = await tickets.setTicketStatus(req.params.id, me(req), status, note);
    await audit({ actor: actorOf(req), action: 'ticket.status', target: { type: 'ticket', id: req.params.id }, before: r.before, after: r.after, reason: note ?? null, ...reqCtx(req) });
    res.json({ success: true, data: await ticketOut(req.params.id) });
}));

router.post('/tickets/:id/take', requirePermission('tickets.reply'), ah(async (req, res) => {
    await tickets.takeTicket(req.params.id, me(req));
    res.json({ success: true, data: await ticketOut(req.params.id) });
}));

/** `{ agentId }` (or `assigneeId`); null unassigns. An agent without tickets.assign may only take an unassigned ticket. */
router.post('/tickets/:id/assign', requirePermission('tickets.reply'), ah(async (req, res) => {
    const to = req.body?.agentId !== undefined ? req.body.agentId : (req.body?.assigneeId ?? null);
    const agent = agentOf(req);
    if (!hasPermission(agent.roles, 'tickets.assign')) {
        if (to !== agent.id) assertPermission(req, 'tickets.assign');
        await tickets.takeTicket(req.params.id, me(req));
    } else {
        const r = await tickets.assignTicket(req.params.id, me(req), to);
        await audit({ actor: actorOf(req), action: 'ticket.assigned', target: { type: 'ticket', id: req.params.id }, before: r.before, after: r.after, ...reqCtx(req) });
    }
    res.json({ success: true, data: await ticketOut(req.params.id) });
}));

router.post('/tickets/:id/priority', requirePermission('tickets.assign'), ah(async (req, res) => {
    const r = await tickets.setTicketPriority(req.params.id, me(req), req.body?.priority);
    await audit({ actor: actorOf(req), action: 'ticket.priority', target: { type: 'ticket', id: req.params.id }, before: r.before, after: r.after, ...reqCtx(req) });
    res.json({ success: true, data: await ticketOut(req.params.id) });
}));

/** Agent upload (multipart `file`, images/PDF ≤ 10 MB) → `{ id }`, then `attachmentIds` in a reply. */
router.post('/attachments', requirePermission('tickets.reply'), upload.single('file'), ah(async (req, res) => {
    const r = await storeAttachment(req.file, { type: 'agent', id: agentOf(req).id });
    res.status(201).json({ success: true, data: r });
}));

// ---- response templates ----
const presentTemplate = (t: any) => ({ id: String(t._id), title: t.title, category: t.category ?? '', language: t.language, body: t.body, active: t.active, updatedAt: t.updatedAt });

router.get('/templates', requirePermission('tickets.reply'), ah(async (req, res) => {
    // Deleted replies stay in the database (active:false) but come back only when a manager
    // explicitly asks: the editor and the composer list the live ones.
    const withDeleted = req.query.includeInactive === '1' && hasPermission(agentOf(req).roles, 'templates.manage');
    const list = await listTemplates(req.query as any, withDeleted);
    const lang = typeof req.query.language === 'string' ? req.query.language : null;
    res.json({ success: true, data: list.filter((t) => !lang || t.language === lang).map(presentTemplate) });
}));

router.post('/templates', requirePermission('templates.manage'), ah(async (req, res) => {
    const t = await saveTemplate(null, req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'template.created', target: { type: 'template', id: String(t._id) }, after: { title: t.title }, ...reqCtx(req) });
    res.status(201).json({ success: true, data: presentTemplate(t) });
}));

router.put('/templates/:id', requirePermission('templates.manage'), ah(async (req, res) => {
    const before = Types.ObjectId.isValid(req.params.id) ? await ResponseTemplate.findById(req.params.id).lean() : null;
    const t = await saveTemplate(req.params.id, req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'template.updated', target: { type: 'template', id: req.params.id }, before: before ? { title: before.title, body: before.body, active: before.active } : null, after: { title: t.title, body: t.body, active: t.active }, ...reqCtx(req) });
    res.json({ success: true, data: presentTemplate(t) });
}));

/** Templates are deactivated, not erased (history stays readable). */
router.delete('/templates/:id', requirePermission('templates.manage'), ah(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const t = await ResponseTemplate.findByIdAndUpdate(req.params.id, { $set: { active: false, updatedBy: agentOf(req).id } }).lean();
    if (!t) throw notFound('Modèle introuvable.');
    await audit({ actor: actorOf(req), action: 'template.deactivated', target: { type: 'template', id: req.params.id }, ...reqCtx(req) });
    res.status(204).end();
}));

export default router;
