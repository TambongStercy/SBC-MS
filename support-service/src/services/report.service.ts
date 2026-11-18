import { Ticket } from '../database/models/ticket.model';
import { Case } from '../database/models/case.model';
import { ViewTask } from '../database/models/view-task.model';
import { badRequest } from '../utils/errors';
import { agentStats } from './views.service';
import { periodEnd } from '../utils/dates';

export function parsePeriod(q: Record<string, unknown>): { from: Date; to: Date } {
    const to = q.to ? periodEnd(q.to) : new Date();
    const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw badRequest('Période invalide.', 'BAD_PERIOD');
    if (to.getTime() - from.getTime() > 366 * 24 * 3600 * 1000) throw badRequest('Période trop longue (un an au plus).', 'BAD_PERIOD');
    return { from, to };
}

export async function summary(from: Date, to: Date) {
    const range = { $gte: from, $lt: to };
    const [ticketsByCategory, ticketsByStatus, ticketTimes, slaBreached, casesByType, casesByStatus, views] = await Promise.all([
        Ticket.aggregate([{ $match: { createdAt: range } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
        Ticket.aggregate([{ $match: { createdAt: range } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Ticket.aggregate([
            { $match: { createdAt: range } },
            {
                $group: {
                    _id: null,
                    avgFirstResponseMs: { $avg: { $cond: [{ $ifNull: ['$sla.firstRespondedAt', false] }, { $subtract: ['$sla.firstRespondedAt', '$createdAt'] }, null] } },
                    avgResolutionMs: { $avg: { $cond: [{ $ifNull: ['$resolvedAt', false] }, { $subtract: ['$resolvedAt', '$createdAt'] }, null] } },
                    total: { $sum: 1 },
                },
            },
        ]),
        Ticket.countDocuments({ createdAt: range, 'sla.breachedAt': { $ne: null } }),
        Case.aggregate([{ $match: { createdAt: range } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
        Case.aggregate([{ $match: { createdAt: range } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        agentStats(from, to),
    ]);
    const obj = (rows: any[]) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const t = ticketTimes[0] ?? {};
    return {
        period: { from, to },
        tickets: {
            total: t.total ?? 0, byCategory: obj(ticketsByCategory), byStatus: obj(ticketsByStatus), slaBreached,
            avgFirstResponseMinutes: t.avgFirstResponseMs ? Math.round(t.avgFirstResponseMs / 60000) : null,
            avgResolutionHours: t.avgResolutionMs ? Math.round(t.avgResolutionMs / 3600000) : null,
        },
        cases: { byType: obj(casesByType), byStatus: obj(casesByStatus) },
        views: { perAgent: views, pending: await ViewTask.countDocuments({ state: 'available' }) },
    };
}

const csvCell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formulas.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV exports: ids and statuses only, never contact details or authentication data. */
export async function exportCsv(type: unknown, from: Date, to: Date): Promise<{ filename: string; csv: string; rows: number }> {
    const range = { $gte: from, $lt: to };
    let header: string[]; let rows: unknown[][];
    if (type === 'tickets') {
        const docs = await Ticket.find({ createdAt: range }).sort({ createdAt: 1 }).limit(50000).lean();
        header = ['number', 'memberId', 'category', 'priority', 'status', 'source', 'assigneeId', 'createdAt', 'firstRespondedAt', 'resolvedAt', 'closedAt', 'slaBreachedAt'];
        rows = docs.map((d) => [d.number, d.memberId, d.category, d.priority, d.status, d.source, d.assigneeId, d.createdAt, d.sla?.firstRespondedAt, d.resolvedAt, d.closedAt, d.sla?.breachedAt]);
    } else if (type === 'cases') {
        const docs = await Case.find({ createdAt: range }).sort({ createdAt: 1 }).limit(50000).lean();
        header = ['id', 'type', 'severity', 'status', 'userId', 'transactionId', 'sessionId', 'gateway', 'occurrences', 'createdAt', 'resolvedAt'];
        rows = docs.map((d) => [d._id, d.type, d.severity, d.status, d.subject?.userId, d.subject?.transactionId, d.subject?.sessionId, d.subject?.gateway, d.occurrences, d.createdAt, d.resolvedAt]);
    } else if (type === 'views') {
        const docs = await ViewTask.find({ 'decision.at': range }).sort({ 'decision.at': 1 }).limit(50000).lean();
        header = ['sourceId', 'campaignId', 'dayIndex', 'country', 'state', 'decision', 'observedViews', 'decidedBy', 'decidedAt', 'startedAt', 'qaVerdict'];
        rows = docs.map((d) => [d.sourceId, d.campaignId, d.dayIndex, d.country, d.state, d.decision?.decision, d.decision?.observedViews, d.decision?.by, d.decision?.at, d.startedAt, d.qa?.verdict]);
    } else {
        throw badRequest('Export inconnu (tickets, cases ou views).', 'BAD_EXPORT');
    }
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
    return { filename: `sbc-support-${type}-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`, csv, rows: rows.length };
}

/** One row per agent for the period (desk "Rapports" screen). */
export async function agentReport(from: Date, to: Date, agentId?: string) {
    const { Agent } = await import('../database/models/agent.model');
    const { TicketMessage, TicketEvent } = await import('../database/models/ticket.model');
    const { Types } = await import('mongoose');
    const range = { $gte: from, $lt: to };
    const agentFilter: Record<string, unknown> = agentId && Types.ObjectId.isValid(agentId) ? { _id: agentId } : { status: { $ne: 'pending' } };
    const agents = await Agent.find(agentFilter, { name: 1, roles: 1 }).sort({ name: 1 }).lean();
    const [handled, resolved, firstResp, casesResolved, views] = await Promise.all([
        TicketMessage.aggregate([
            { $match: { createdAt: range, 'author.type': 'agent', internal: false } },
            { $group: { _id: { a: '$author.id', t: '$ticketId' } } }, { $group: { _id: '$_id.a', n: { $sum: 1 } } },
        ]),
        TicketEvent.aggregate([{ $match: { createdAt: range, kind: 'status', to: 'resolu' } }, { $group: { _id: '$by.id', n: { $sum: 1 } } }]),
        Ticket.aggregate([
            { $match: { 'sla.firstRespondedAt': range, assigneeId: { $ne: null } } },
            { $group: { _id: '$assigneeId', avg: { $avg: { $subtract: ['$sla.firstRespondedAt', '$createdAt'] } } } },
        ]),
        Case.aggregate([
            { $unwind: '$history' }, { $match: { 'history.kind': 'status', 'history.to': { $in: ['resolved', 'closed'] }, 'history.at': range } },
            { $group: { _id: '$history.by', n: { $sum: 1 } } },
        ]),
        agentStats(from, to),
    ]);
    const m = (rows: any[]) => Object.fromEntries(rows.map((r) => [String(r._id), r]));
    const H = m(handled), R = m(resolved), F = m(firstResp), C = m(casesResolved);
    const V = Object.fromEntries(views.map((v) => [v.agentId, v]));
    return {
        from: from.toISOString(), to: to.toISOString(),
        rows: agents.map((a) => {
            const id = String(a._id);
            const v: any = V[id] ?? {};
            return {
                agentId: id, name: a.name, roles: a.roles,
                ticketsHandled: H[id]?.n ?? 0, ticketsResolved: R[id]?.n ?? 0,
                avgFirstResponseMinutes: F[id]?.avg ? Math.round(F[id].avg / 60000) : null,
                casesResolved: C[id]?.n ?? 0,
                viewsDecided: (v.approved ?? 0) + (v.rejected ?? 0), viewsApproved: v.approved ?? 0, viewsRejected: v.rejected ?? 0,
                viewsReassigned: v.reassigned ?? 0, avgDecisionSeconds: v.avgHandleSeconds ?? null, qaErrorRate: v.errorRate ?? null,
            };
        }),
    };
}

export function agentReportCsv(r: Awaited<ReturnType<typeof agentReport>>) {
    const header = ['agentId', 'name', 'roles', 'ticketsHandled', 'ticketsResolved', 'avgFirstResponseMinutes', 'casesResolved', 'viewsDecided', 'viewsApproved', 'viewsRejected', 'viewsReassigned', 'avgDecisionSeconds', 'qaErrorRate'];
    const rows = r.rows.map((x) => [x.agentId, x.name, x.roles.join('|'), x.ticketsHandled, x.ticketsResolved, x.avgFirstResponseMinutes, x.casesResolved, x.viewsDecided, x.viewsApproved, x.viewsRejected, x.viewsReassigned, x.avgDecisionSeconds, x.qaErrorRate]);
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
