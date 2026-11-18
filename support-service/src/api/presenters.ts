import { Types } from 'mongoose';
import { Agent } from '../database/models/agent.model';
import { TICKET_STATUS_KEYS, TicketStatus } from '../config/constants';
import { APPROVAL_PERMISSIONS } from '../services/approval.service';
import { attachmentLinks } from '../services/attachment.service';
import { getSupportDetails } from '../services/clients/user.client';

/**
 * Desk response shapes, as support-frontend expects them (its src/api/types.ts).
 * Storage keeps the contract keys; this layer only renames.
 */

// Ticket statuses are stored with the CdC French keys (the member app uses
// them); the desk speaks English keys.
const STATUS_TO_DESK: Record<TicketStatus, string> = {
    nouveau: 'new', ouvert: 'open', en_attente_membre: 'waiting_member', en_attente_interne: 'waiting_internal', resolu: 'resolved', ferme: 'closed',
};
const STATUS_FROM_DESK: Record<string, TicketStatus> = Object.fromEntries(Object.entries(STATUS_TO_DESK).map(([k, v]) => [v, k as TicketStatus]));

export const deskStatus = (s: string) => STATUS_TO_DESK[s as TicketStatus] ?? s;
/** Accepts either the desk key or the stored key. */
export const storedStatus = (s: unknown): string | undefined =>
    typeof s !== 'string' ? undefined : STATUS_FROM_DESK[s] ?? (TICKET_STATUS_KEYS.includes(s as TicketStatus) ? s : undefined);

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** id → {id, name} for every agent id found in the given values. */
export async function agentNames(ids: (string | Types.ObjectId | null | undefined)[]): Promise<Record<string, { id: string; name: string }>> {
    const valid = [...new Set(ids.filter(Boolean).map(String))].filter((i) => Types.ObjectId.isValid(i));
    if (!valid.length) return {};
    const docs = await Agent.find({ _id: { $in: valid } }, { name: 1 }).lean();
    return Object.fromEntries(docs.map((d) => [String(d._id), { id: String(d._id), name: d.name }]));
}

/**
 * userId → member name, in one batch (user-service support projection). Best effort:
 * if user-service is slow or down, the screens show the id instead of failing.
 */
export async function memberNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
    const valid = [...new Set(ids.filter(Boolean).map(String))].filter((i) => /^[a-f0-9]{24}$/i.test(i));
    if (!valid.length) return {};
    try {
        const out: Record<string, string> = {};
        for (let i = 0; i < valid.length; i += 100) {
            for (const m of await getSupportDetails(valid.slice(i, i + 100))) if (m?.name) out[String(m._id)] = m.name;
        }
        return out;
    } catch {
        return {};
    }
}

export function presentTicket(t: any, names: Record<string, { id: string; name: string }>, members: Record<string, string> = {}) {
    return {
        id: String(t._id), number: t.number, subject: t.subject, category: t.category, queue: t.queue, priority: t.priority,
        status: deskStatus(t.status), storedStatus: t.status, source: t.source,
        member: { id: t.memberId, name: t.memberName ?? members[String(t.memberId)] ?? t.memberId },
        assignee: t.assigneeId ? names[String(t.assigneeId)] ?? { id: String(t.assigneeId), name: '—' } : null,
        slaDueAt: iso(t.sla?.firstRespondedAt ? t.sla?.resolutionDueAt : t.sla?.firstResponseDueAt),
        slaBreachedAt: iso(t.sla?.breachedAt),
        createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt),
        lastMessageAt: iso([t.lastMemberMessageAt, t.lastAgentMessageAt].filter(Boolean).sort().pop()),
        caseId: t.caseId ? String(t.caseId) : null,
    };
}

export async function presentTickets(list: any[]) {
    const [names, members] = await Promise.all([agentNames(list.map((t) => t.assigneeId)), memberNames(list.filter((t) => !t.memberName).map((t) => t.memberId))]);
    return list.map((t) => presentTicket(t, names, members));
}

export async function presentMessage(m: any) {
    const atts = await attachmentLinks(m.attachmentIds ?? []);
    return {
        id: String(m._id), author: { type: m.author.type, id: m.author.id ?? undefined, name: m.author.name ?? (m.author.type === 'member' ? 'Membre' : 'SBC') },
        body: m.body, internal: Boolean(m.internal), createdAt: iso(m.createdAt),
        attachments: atts.map((a) => ({ id: a.id, name: a.filename, mimeType: a.mime, size: a.size })),
    };
}

export function presentEvent(e: any, agents: Record<string, { id: string; name: string }> = {}) {
    const kind = e.kind === 'assigned' ? 'assign' : e.kind;
    const conv = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' ? (kind === 'status' ? deskStatus(v) : v) : JSON.stringify(v));
    const to = conv(e.to);
    return {
        id: String(e._id), type: kind, actor: e.by?.id ? { id: String(e.by.id), name: e.by.name ?? '' } : undefined,
        from: conv(e.from), to, toName: kind === 'assign' && to ? agents[to]?.name ?? null : undefined,
        reason: e.note ?? undefined, at: iso(e.createdAt),
    };
}

/** Events with the assigned agents' names resolved (the timeline shows names, not ids). */
export async function presentEvents(list: any[]) {
    const agents = await agentNames(list.filter((e) => e.kind === 'assigned' || e.kind === 'assign').map((e) => (typeof e.to === 'string' ? e.to : null)));
    return list.map((e) => presentEvent(e, agents));
}

export function presentCase(c: any, names: Record<string, { id: string; name: string }>, members: Record<string, string> = {}) {
    return {
        id: String(c._id), type: c.type, status: c.status, severity: c.severity, dedupKey: c.dedupKey,
        subject: { userId: c.subject?.userId ?? undefined, memberName: c.subject?.userId ? members[String(c.subject.userId)] : undefined, transactionId: c.subject?.transactionId ?? undefined, sessionId: c.subject?.sessionId ?? undefined, gateway: c.subject?.gateway ?? undefined },
        summary: c.summary, details: c.details ?? undefined, source: c.source, occurrences: c.occurrences,
        assignee: c.assigneeId ? names[String(c.assigneeId)] ?? { id: String(c.assigneeId), name: '—' } : null,
        createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt), ticketId: c.ticketId ? String(c.ticketId) : null,
        checks: (c.checks ?? []).map((x: any) => ({ ...(x.result ?? {}), checkedAt: (x.result?.checkedAt ?? iso(x.at)), requestId: x.result?.requestId ?? x.requestId ?? '' })),
        comments: (c.comments ?? []).map((x: any, i: number) => ({ id: `${String(c._id)}-${i}`, author: { id: x.agentId, name: x.name }, body: x.body, createdAt: iso(x.at) })),
        history: c.history ?? [],
    };
}

export async function presentCases(list: any[]) {
    const [names, members] = await Promise.all([agentNames(list.map((c) => c.assigneeId)), memberNames(list.map((c) => c.subject?.userId))]);
    return list.map((c) => presentCase(c, names, members));
}

function approvalSummary(a: any): string {
    const p = a.payload ?? {};
    switch (a.type) {
        case 'manual_activation': return `Activation manuelle ${p.plan ?? ''} pour le membre ${p.userId ?? ''} (${p.gateway ?? ''}, réf. ${p.externalRef ?? ''})`;
        case 'regularization': return `Régularisation du retrait ${p.transactionId ?? ''} : ${p.action === 'complete' ? 'marquer effectué' : 'marquer échoué'}`;
        case 'contact_change': return `Changement ${p.field === 'email' ? 'd’email' : 'de téléphone'} pour le membre ${a.subject?.userId ?? ''} → ${p.newValue ?? ''}`;
        default: return APPROVAL_PERMISSIONS[a.type as keyof typeof APPROVAL_PERMISSIONS]?.label ?? a.type;
    }
}

export function presentApproval(a: any) {
    const decided = a.rejectedBy ?? a.approvals?.[a.approvals.length - 1]?.agent ?? null;
    const decidedAt = a.rejectedBy ? a.updatedAt : a.approvals?.[a.approvals.length - 1]?.at ?? null;
    return {
        id: String(a._id), type: a.type, status: a.status, summary: approvalSummary(a), reason: a.reason, payload: a.payload,
        subject: a.subject ?? {}, requestedBy: { id: a.requestedBy.id, name: a.requestedBy.name }, requestedAt: iso(a.createdAt),
        decidedBy: decided ? { id: decided.id, name: decided.name } : null, decidedAt: iso(decidedAt),
        decisionNote: a.rejectionReason ?? a.approvals?.[a.approvals.length - 1]?.note ?? null,
        execution: a.execution ?? null, caseId: a.caseId ? String(a.caseId) : null, ticketId: a.ticketId ? String(a.ticketId) : null,
    };
}

const VIEW_DECISION_TO_DESK: Record<string, string> = { approve: 'approve', reject: 'reject', to_review: 'review', tech_error: 'technical_error' };

const PROOF_STATUS_FR: Record<string, string> = { approved: 'validée', rejected: 'rejetée', pending_review: 'en attente', pending: 'en attente' };
const frDate = (d: unknown) => (d ? new Date(d as string).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

/**
 * advertising-service's proof (CONTRACT §2.3) in the agent app's shape: the
 * history becomes a dated list of plain-French lines (events, then earlier
 * attempts), and a name advertising could not read is never sent as null.
 */
export function presentProof(raw: any) {
    if (!raw || typeof raw !== 'object') return raw ?? null;
    const events = (Array.isArray(raw.history?.events) ? raw.history.events : []).map((e: any) => {
        const who = e.by?.name ? ` par ${e.by.name}` : '';
        const label = e.action === 'submitted' ? 'Preuve envoyée'
            : e.action === 'approved' ? `Validée${typeof e.observedViewCount === 'number' ? ` (${e.observedViewCount} vues)` : ''}${who}`
            : e.action === 'rejected' ? `Rejetée${who}${e.reason ? ` : ${e.reason}` : ''}${e.ban ? ' (diffuseur banni)' : ''}`
            : e.action === 'decision_reverted' ? `Décision annulée${e.reason ? ` : ${e.reason}` : ''}`
            : String(e.action ?? 'Événement');
        return { at: iso(e.at), label };
    });
    const attempts = (Array.isArray(raw.history?.previousAttempts) ? raw.history.previousAttempts : []).map((a: any) => ({
        at: iso(a.submittedAt ?? a.reviewedAt),
        label: `Tentative précédente (jour ${a.dayIndex}, ${frDate(a.submittedAt)}) : ${PROOF_STATUS_FR[a.status] ?? a.status}${a.rejectionReason ? ` — ${a.rejectionReason}` : ''}`,
    }));
    const history = Array.isArray(raw.history) ? raw.history : [...events, ...attempts].sort((x, y) => String(x.at ?? '').localeCompare(String(y.at ?? '')));
    return {
        ...raw,
        campaign: { ...(raw.campaign ?? {}), name: raw.campaign?.name || 'Campagne sans titre' },
        diffuseur: { ...(raw.diffuseur ?? {}), name: raw.diffuseur?.name || 'Nom indisponible' },
        history,
    };
}

export function presentViewTask(t: any, names: Record<string, { id: string; name: string }>, proof?: unknown) {
    return {
        id: String(t._id), sourceId: t.sourceId, state: t.state,
        assignee: t.assigneeId ? names[String(t.assigneeId)] ?? { id: String(t.assigneeId), name: '—' } : null,
        assignedAt: iso(t.assignedAt), startedAt: iso(t.startedAt), lastActivityAt: iso(t.lastActivityAt),
        decidedAt: iso(t.decision?.at), decision: t.decision?.decision ? VIEW_DECISION_TO_DESK[t.decision.decision] ?? t.decision.decision : null,
        observedViews: t.decision?.observedViews ?? null, reason: t.decision?.reason ?? null, version: t.version,
        country: t.country ?? undefined, dayIndex: t.dayIndex ?? undefined, campaignId: t.campaignId ?? undefined,
        submittedAt: iso(t.submittedAt), qa: t.qa ?? null, ...(proof !== undefined ? { proof: presentProof(proof) } : {}),
    };
}

export async function presentViewTasks(list: any[]) {
    const names = await agentNames(list.map((t) => t.assigneeId));
    return list.map((t) => presentViewTask(t, names));
}

export function presentAudit(e: any) {
    return {
        id: String(e._id), seq: e.seq, at: iso(e.at),
        actor: e.actor ? { id: e.actor.id ?? e.actor.type, name: e.actor.name ?? e.actor.type, role: e.actor.roles?.[0] ?? e.actor.type } : null,
        action: e.action, result: e.result, object: e.target?.id ? { type: e.target.type ?? '', id: e.target.id } : null,
        reason: e.reason ?? null, ip: e.ip ?? undefined, userAgent: e.userAgent ?? undefined, requestId: e.requestId ?? undefined,
        before: e.before ?? null, after: e.after ?? null, meta: e.meta ?? null, hash: e.hash, prevHash: e.prevHash,
    };
}

/** Owner-service lists may come as an array or as a page; the desk always gets a page. */
export function asPage(data: any, page = 1, limit = 50) {
    if (Array.isArray(data)) return { items: data, total: data.length, page, limit };
    return { items: data?.items ?? [], total: data?.total ?? (data?.items?.length ?? 0), page: data?.page ?? page, limit: data?.limit ?? limit };
}

export const page = (q: Record<string, unknown>, def = 30) => ({
    page: Math.max(1, parseInt(String(q.page || '1'), 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(String(q.limit || def), 10) || def)),
});
