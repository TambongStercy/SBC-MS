import { Types, FilterQuery } from 'mongoose';
import {
    OPEN_TICKET_STATUSES, SLA_HOURS, TICKET_CATEGORIES, TICKET_CATEGORY_KEYS, TICKET_PRIORITIES, TICKET_STATUS_KEYS,
    TicketPriority, TicketStatus,
} from '../config/constants';
import { nextSeq } from '../database/models/counter.model';
import { ITicket, Ticket, TicketEvent, TicketMessage } from '../database/models/ticket.model';
import { Agent } from '../database/models/agent.model';
import { badRequest, conflict, notFound } from '../utils/errors';
import { attachmentLinks, claimAttachments } from './attachment.service';
import { notifyAgents, notifyMember } from './notifier.service';
import { publishTicketEvent } from './realtime.service';

export const formatTicketNumber = (n: number) => `SUP-${String(n).padStart(6, '0')}`;

const HOUR = 3600 * 1000;

export function slaFor(priority: TicketPriority, from = new Date()) {
    const h = SLA_HOURS[priority];
    return { firstResponseDueAt: new Date(from.getTime() + h.firstResponse * HOUR), resolutionDueAt: new Date(from.getTime() + h.resolution * HOUR) };
}

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type Actor = { type: 'member' | 'agent' | 'assistant' | 'system'; id?: string | null; name?: string | null };

async function event(ticketId: Types.ObjectId | string, kind: string, by: Actor | null, from?: unknown, to?: unknown, note?: string) {
    await TicketEvent.create({ ticketId, kind, by, from: from ?? null, to: to ?? null, note: note ?? null });
}

export async function createTicket(args: {
    memberId: string; memberName?: string | null; category: unknown; subject: unknown; body: unknown;
    source: 'member' | 'assistant' | 'system' | 'agent'; attachmentIds?: unknown; botConversationId?: Types.ObjectId | null;
    caseId?: Types.ObjectId | null; priority?: TicketPriority; author: Actor;
}) {
    const category = String(args.category);
    if (!TICKET_CATEGORY_KEYS.includes(category as any)) throw badRequest('Catégorie inconnue.', 'BAD_CATEGORY');
    const subject = cleanText(args.subject, 200);
    const body = cleanText(args.body, 10000);
    if (subject.length < 3) throw badRequest('Indiquez un objet (3 caractères au moins).', 'BAD_SUBJECT');
    if (body.length < 3) throw badRequest('Décrivez votre demande.', 'BAD_BODY');
    const cat = TICKET_CATEGORIES.find((c) => c.key === category)!;
    const priority = (args.priority ?? cat.defaultPriority) as TicketPriority;
    const number = formatTicketNumber(await nextSeq('ticket'));
    const now = new Date();
    const ticket = await Ticket.create({
        number, memberId: args.memberId, memberName: args.memberName ?? null, subject, category, queue: category, priority,
        status: 'nouveau', source: args.source, sla: slaFor(priority, now), lastMemberMessageAt: args.author.type === 'member' ? now : null,
        botConversationId: args.botConversationId ?? null, caseId: args.caseId ?? null,
    });
    const ownerId = args.author.type === 'member' ? args.memberId : String(args.author.id ?? '');
    const attachmentIds = ownerId ? await claimAttachments(args.attachmentIds, ownerId, ticket._id) : [];
    await TicketMessage.create({ ticketId: ticket._id, author: args.author, body, internal: false, attachmentIds });
    await event(ticket._id, 'created', args.author, null, { status: 'nouveau', category, priority });
    await notifyAgents({ role: 'support_agent', kind: 'ticket.new', title: `Nouveau ticket ${number}`, body: `${cat.label} : ${subject.slice(0, 80)}`, link: `/tickets/${ticket._id}`, dedupKey: `ticket-new:${ticket._id}` });
    publishTicketEvent({ ticketId: String(ticket._id), memberId: args.memberId, kind: 'created', forMember: true });
    return ticket.toObject();
}

/** What a member may see of a ticket: never internal notes, never agent ids. */
export function memberView(t: ITicket & { _id: unknown }) {
    return {
        id: String(t._id), number: t.number, subject: t.subject, category: t.category, status: t.status,
        createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt ?? null, closedAt: t.closedAt ?? null,
    };
}

export async function listMemberTickets(memberId: string) {
    const docs = await Ticket.find({ memberId }).sort({ createdAt: -1 }).limit(100).lean();
    return docs.map(memberView);
}

async function messagesFor(ticketId: Types.ObjectId, includeInternal: boolean) {
    const filter: FilterQuery<any> = { ticketId };
    if (!includeInternal) filter.internal = false;
    const msgs = await TicketMessage.find(filter).sort({ createdAt: 1 }).limit(500).lean();
    return Promise.all(msgs.map(async (m) => ({
        id: String(m._id),
        author: includeInternal ? m.author : { type: m.author.type, name: m.author.type === 'agent' ? (m.author.name || 'Équipe SBC').split(' ')[0] : m.author.name },
        body: m.body, internal: m.internal, createdAt: m.createdAt, attachments: await attachmentLinks(m.attachmentIds),
    })));
}

export async function getMemberTicket(id: string, memberId: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await Ticket.findOne({ _id: id, memberId }).lean();
    if (!t) throw notFound('Demande introuvable.');
    return { ...memberView(t), messages: await messagesFor(t._id, false) };
}

export async function memberReply(id: string, memberId: string, body: unknown, attachmentIds: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const text = cleanText(body, 10000);
    if (!text) throw badRequest('Message vide.', 'BAD_BODY');
    const t = await Ticket.findOne({ _id: id, memberId }).lean();
    if (!t) throw notFound('Demande introuvable.');
    if (t.status === 'ferme') throw conflict('Cette demande est fermée. Ouvrez une nouvelle demande.', 'TICKET_CLOSED');
    const ids = await claimAttachments(attachmentIds, memberId, t._id);
    await TicketMessage.create({ ticketId: t._id, author: { type: 'member', id: memberId }, body: text, internal: false, attachmentIds: ids });
    const reopen = t.status === 'en_attente_membre' || t.status === 'resolu';
    await Ticket.updateOne({ _id: t._id }, { $set: { lastMemberMessageAt: new Date(), ...(reopen ? { status: 'ouvert', resolvedAt: null } : {}) } });
    if (reopen) await event(t._id, 'status', { type: 'member', id: memberId }, t.status, 'ouvert', 'member reply');
    if (t.assigneeId) {
        await notifyAgents({ agentId: String(t.assigneeId), kind: 'ticket.reply', title: `Réponse du membre sur ${t.number}`, body: t.subject, link: `/tickets/${t._id}` });
    }
    publishTicketEvent({ ticketId: String(t._id), memberId, kind: 'message', forMember: true });
    return getMemberTicket(id, memberId);
}

export async function memberClose(id: string, memberId: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await Ticket.findOneAndUpdate({ _id: id, memberId, status: { $ne: 'ferme' } }, { $set: { status: 'ferme', closedAt: new Date() } }).lean();
    if (!t) throw notFound('Demande introuvable ou déjà fermée.');
    await event(t._id, 'status', { type: 'member', id: memberId }, t.status, 'ferme', 'closed by member');
    publishTicketEvent({ ticketId: String(t._id), memberId, kind: 'status', forMember: true });
    return { ok: true };
}

// ---------- Desk ----------

export async function listDeskTickets(q: Record<string, unknown>, agentId: string) {
    const filter: FilterQuery<ITicket> = {};
    if (typeof q.status === 'string') {
        if (q.status === 'active') filter.status = { $in: OPEN_TICKET_STATUSES };
        else if (TICKET_STATUS_KEYS.includes(q.status as TicketStatus)) filter.status = q.status;
    }
    if (typeof q.priority === 'string' && TICKET_PRIORITIES.includes(q.priority as TicketPriority)) filter.priority = q.priority;
    if (typeof q.q === 'string' && q.q.trim()) {
        const text = q.q.trim().slice(0, 100);
        const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ number: text.toUpperCase() }, { subject: { $regex: esc, $options: 'i' } }, { memberId: text }];
    }
    if (typeof q.queue === 'string' && TICKET_CATEGORY_KEYS.includes(q.queue as any)) filter.queue = q.queue;
    if (q.assignee === 'me') filter.assigneeId = new Types.ObjectId(agentId);
    else if (q.assignee === 'unassigned') filter.assigneeId = null;
    else if (typeof q.assignee === 'string' && Types.ObjectId.isValid(q.assignee)) filter.assigneeId = new Types.ObjectId(q.assignee);
    if (typeof q.memberId === 'string' && /^[a-f0-9]{24}$/i.test(q.memberId)) filter.memberId = q.memberId;
    if (typeof q.number === 'string' && q.number.trim()) filter.number = q.number.trim().toUpperCase();
    if (q.slaBreached === 'true') filter['sla.breachedAt'] = { $ne: null };
    const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(q.limit || '30'), 10) || 30));
    const [items, total] = await Promise.all([
        Ticket.find(filter).sort({ 'sla.firstResponseDueAt': 1, createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Ticket.countDocuments(filter),
    ]);
    return { items, total, page, limit };
}

export async function getDeskTicket(id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await Ticket.findById(id).lean();
    if (!t) throw notFound('Ticket introuvable.');
    const [messages, events] = await Promise.all([
        messagesFor(t._id, true),
        TicketEvent.find({ ticketId: t._id }).sort({ createdAt: 1 }).limit(500).lean(),
    ]);
    return { ticket: t, messages, events };
}

export async function deskReply(id: string, agent: { id: string; name: string }, input: { body?: unknown; internal?: unknown; status?: unknown; attachmentIds?: unknown }) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const body = cleanText(input.body, 10000);
    if (!body) throw badRequest('Message vide.', 'BAD_BODY');
    const internal = input.internal === true;
    const t = await Ticket.findById(id).lean();
    if (!t) throw notFound('Ticket introuvable.');
    if (t.status === 'ferme') throw conflict('Ce ticket est fermé.', 'TICKET_CLOSED');
    const ids = await claimAttachments(input.attachmentIds, agent.id, t._id);
    const author = { type: 'agent' as const, id: agent.id, name: agent.name };
    const message = await TicketMessage.create({ ticketId: t._id, author, body, internal, attachmentIds: ids });
    const set: Record<string, unknown> = {};
    if (!internal) {
        set.lastAgentMessageAt = new Date();
        if (!t.sla?.firstRespondedAt) set['sla.firstRespondedAt'] = new Date();
        const next = typeof input.status === 'string' && TICKET_STATUS_KEYS.includes(input.status as TicketStatus) ? input.status : 'en_attente_membre';
        if (next !== t.status) {
            set.status = next;
            if (next === 'resolu') set.resolvedAt = new Date();
        }
    }
    if (!t.assigneeId) set.assigneeId = new Types.ObjectId(agent.id);
    if (Object.keys(set).length) await Ticket.updateOne({ _id: t._id }, { $set: set });
    if (set.status) await event(t._id, 'status', author, t.status, set.status);
    if (set.assigneeId) await event(t._id, 'assigned', author, null, agent.id, 'took the ticket by replying');
    if (!internal) {
        await notifyMember({
            userId: t.memberId, tag: `support-ticket-${t._id}`, title: `Réponse à votre demande ${t.number}`,
            body: 'Un agent SBC a répondu à votre demande. Ouvrez l’espace Aide pour la lire.', path: `/aide/demandes/${t._id}`,
        });
    }
    // An internal note reaches the desk only: the member never learns it exists.
    publishTicketEvent({ ticketId: String(t._id), memberId: t.memberId, kind: 'message', forMember: !internal });
    return message.toObject();
}

export async function setTicketStatus(id: string, agent: { id: string; name: string }, status: unknown, note?: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (typeof status !== 'string' || !TICKET_STATUS_KEYS.includes(status as TicketStatus)) throw badRequest('Statut inconnu.', 'BAD_STATUS');
    const now = new Date();
    const set: Record<string, unknown> = { status };
    if (status === 'resolu') set.resolvedAt = now;
    if (status === 'ferme') set.closedAt = now;
    const before = await Ticket.findOneAndUpdate({ _id: id, status: { $ne: status } }, { $set: set }).lean();
    if (!before) throw conflict('Le ticket a déjà ce statut, ou n’existe pas.', 'NO_CHANGE');
    await event(before._id, 'status', { type: 'agent', id: agent.id, name: agent.name }, before.status, status, note);
    publishTicketEvent({ ticketId: String(before._id), memberId: before.memberId, kind: 'status', forMember: true });
    if (status === 'resolu') {
        await notifyMember({
            userId: before.memberId, tag: `support-ticket-${before._id}-resolved`, title: `Demande ${before.number} résolue`,
            body: 'Votre demande est marquée comme résolue. Si ce n’est pas le cas, répondez simplement dans l’espace Aide.', path: `/aide/demandes/${before._id}`,
        });
    }
    return { before: before.status, after: status };
}

export async function assignTicket(id: string, by: { id: string; name: string }, assigneeId: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    let to: Types.ObjectId | null = null;
    if (assigneeId !== null) {
        if (typeof assigneeId !== 'string' || !Types.ObjectId.isValid(assigneeId)) throw badRequest('Agent inconnu.', 'BAD_AGENT');
        const a = await Agent.findOne({ _id: assigneeId, status: 'active' }, { _id: 1 }).lean();
        if (!a) throw badRequest('Agent inconnu ou inactif.', 'BAD_AGENT');
        to = a._id as Types.ObjectId;
    }
    const before = await Ticket.findByIdAndUpdate(id, { $set: { assigneeId: to } }).lean();
    if (!before) throw notFound('Ticket introuvable.');
    await event(before._id, 'assigned', { type: 'agent', id: by.id, name: by.name }, before.assigneeId ? String(before.assigneeId) : null, to ? String(to) : null);
    publishTicketEvent({ ticketId: String(before._id), kind: 'assigned', forMember: false });
    if (to && String(to) !== by.id) {
        await notifyAgents({ agentId: String(to), kind: 'ticket.assigned', title: `Ticket ${before.number} attribué`, body: before.subject, link: `/tickets/${before._id}` });
    }
    return { before: before.assigneeId ? String(before.assigneeId) : null, after: to ? String(to) : null };
}

/** Self-assignment of an unassigned ticket (agents without tickets.assign). */
export async function takeTicket(id: string, agent: { id: string; name: string }) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const t = await Ticket.findOneAndUpdate({ _id: id, assigneeId: null }, { $set: { assigneeId: new Types.ObjectId(agent.id) } }).lean();
    if (!t) throw conflict('Ce ticket est déjà attribué.', 'ALREADY_ASSIGNED');
    await event(t._id, 'assigned', { type: 'agent', id: agent.id, name: agent.name }, null, agent.id, 'taken');
    publishTicketEvent({ ticketId: String(t._id), kind: 'assigned', forMember: false });
    return { ok: true };
}

export async function setTicketPriority(id: string, by: { id: string; name: string }, priority: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (typeof priority !== 'string' || !TICKET_PRIORITIES.includes(priority as TicketPriority)) throw badRequest('Priorité inconnue.', 'BAD_PRIORITY');
    const t = await Ticket.findById(id).lean();
    if (!t) throw notFound('Ticket introuvable.');
    const sla = slaFor(priority as TicketPriority, t.createdAt ?? new Date());
    await Ticket.updateOne({ _id: id }, { $set: { priority, 'sla.firstResponseDueAt': sla.firstResponseDueAt, 'sla.resolutionDueAt': sla.resolutionDueAt } });
    await event(t._id, 'priority', { type: 'agent', id: by.id, name: by.name }, t.priority, priority);
    publishTicketEvent({ ticketId: String(t._id), kind: 'priority', forMember: false });
    return { before: t.priority, after: priority };
}

// ---------- Jobs ----------

/** Resolved tickets with no answer for N days are closed. */
export async function autoCloseResolved(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * HOUR);
    const due = await Ticket.find({ status: 'resolu', resolvedAt: { $lte: cutoff } }, { _id: 1, memberId: 1 }).limit(1000).lean();
    let closed = 0;
    for (const t of due) {
        const r = await Ticket.updateOne({ _id: t._id, status: 'resolu' }, { $set: { status: 'ferme', closedAt: new Date() } });
        if (r.modifiedCount === 1) {
            closed++;
            await event(t._id, 'status', { type: 'system' }, 'resolu', 'ferme', `auto-close after ${days} days`);
            publishTicketEvent({ ticketId: String(t._id), memberId: (t as any).memberId, kind: 'status', forMember: true });
        }
    }
    return closed;
}

/** Marks tickets past their first-response or resolution target and alerts. */
export async function checkSla(): Promise<number> {
    const now = new Date();
    const late = await Ticket.find({
        status: { $in: OPEN_TICKET_STATUSES }, 'sla.breachedAt': null,
        $or: [
            { 'sla.firstRespondedAt': null, 'sla.firstResponseDueAt': { $lte: now } },
            { 'sla.resolutionDueAt': { $lte: now } },
        ],
    }).limit(500).lean();
    let n = 0;
    for (const t of late) {
        const r = await Ticket.updateOne({ _id: t._id, 'sla.breachedAt': null }, { $set: { 'sla.breachedAt': now } });
        if (r.modifiedCount !== 1) continue;
        n++;
        await event(t._id, 'sla_breached', { type: 'system' });
        const target = t.assigneeId ? { agentId: String(t.assigneeId) } : { role: 'support_agent' };
        await notifyAgents({ ...target, kind: 'ticket.sla', title: `Délai dépassé : ${t.number}`, body: t.subject, link: `/tickets/${t._id}`, dedupKey: `sla:${t._id}` });
    }
    return n;
}
