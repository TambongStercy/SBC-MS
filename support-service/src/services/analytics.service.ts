import { Types } from 'mongoose';
import { Ticket, TicketEvent } from '../database/models/ticket.model';
import { Case } from '../database/models/case.model';
import { Approval } from '../database/models/approval.model';
import { BotConversation } from '../database/models/bot.model';
import { Agent } from '../database/models/agent.model';
import { ClientErrorDay, ClientErrorMember, ClientErrorType } from '../database/models/client-error.model';
import { OPEN_TICKET_STATUSES, TICKET_CATEGORIES } from '../config/constants';
import { dayKey } from './client-error.service';

/**
 * The support administrator's analytics (desk « Analytique »): what members report
 * (requests, how fast and how well they are handled, what keeps coming back), the
 * technical errors their app hits, and the load on the team. Every figure of the
 * period is given with the previous period of the same length, to see the trend.
 */

const H = 3600_000;
const MIN = 60_000;

const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], p: number) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10);

/** Every day of the period, Douala time. */
function daysOf(from: Date, to: Date): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let t = from.getTime(); t < to.getTime(); t += 6 * H) {
        const k = dayKey(new Date(t));
        if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
    // The steps can stop short of the last day (e.g. just after midnight): always include it.
    const last = dayKey(new Date(to.getTime() - 1));
    if (!seen.has(last)) out.push(last);
    return out;
}

type T = {
    _id: Types.ObjectId; createdAt: Date; category: string; priority: string; source: string; status: string;
    assigneeId?: Types.ObjectId | null; resolvedAt?: Date | null; closedAt?: Date | null;
    sla?: { firstRespondedAt?: Date | null; breachedAt?: Date | null };
};
/** When a request was handled: resolved or closed, whichever came first. */
const handledAt = (t: T) => {
    const xs = [t.resolvedAt, t.closedAt].filter(Boolean).map((d) => new Date(d as Date).getTime());
    return xs.length ? Math.min(...xs) : null;
};
const PROJ = { createdAt: 1, category: 1, priority: 1, source: 1, status: 1, assigneeId: 1, resolvedAt: 1, closedAt: 1, sla: 1 };

function ticketKpis(created: T[], handled: T[]) {
    const first = created.filter((t) => t.sla?.firstRespondedAt).map((t) => (new Date(t.sla!.firstRespondedAt!).getTime() - new Date(t.createdAt).getTime()) / MIN);
    const resolution = created.map((t) => { const h = handledAt(t); return h ? (h - new Date(t.createdAt).getTime()) / H : null; }).filter((v): v is number => v !== null);
    const breached = created.filter((t) => t.sla?.breachedAt).length;
    const handledOfCreated = created.filter((t) => handledAt(t) !== null).length;
    return {
        created: created.length,
        handled: handled.length,
        handledOfCreatedRate: rate(handledOfCreated, created.length),
        firstResponseMedianMin: round1(median(first)),
        firstResponseP90Min: round1(pct(first, 90)),
        resolutionMedianHours: round1(median(resolution)),
        resolutionP90Hours: round1(pct(resolution, 90)),
        slaBreachRate: rate(breached, created.length),
    };
}

export async function analytics(from: Date, to: Date) {
    // A period « up to today » ends now: no empty future day at the end of the curves.
    to = new Date(Math.min(to.getTime(), Date.now()));
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);
    const now = new Date();
    const days = daysOf(from, to);
    const inCur = (d: Date | number) => { const t = new Date(d).getTime(); return t >= from.getTime() && t < to.getTime(); };
    const inPrev = (d: Date | number) => { const t = new Date(d).getTime(); return t >= prevFrom.getTime() && t < from.getTime(); };
    const wide = { $gte: prevFrom, $lt: to };

    const [createdWide, handledWide, overlapping, openNow, reopened, reopenedPrev, bots, botsPrev, escalated, escalatedPrev,
        casesOpened, casesResolved, casesOpenNow, casesCritical, approvalsPending] = await Promise.all([
        Ticket.find({ createdAt: wide }, PROJ).lean<T[]>(),
        Ticket.find({ $or: [{ resolvedAt: wide }, { closedAt: wide }] }, PROJ).lean<T[]>(),
        // Everything that was open at some point of the period, for the backlog curve.
        Ticket.find({ createdAt: { $lt: to }, $or: [{ status: { $in: OPEN_TICKET_STATUSES } }, { resolvedAt: { $gte: from } }, { closedAt: { $gte: from } }] }, PROJ).lean<T[]>(),
        Ticket.find({ status: { $in: OPEN_TICKET_STATUSES } }, { createdAt: 1, assigneeId: 1, priority: 1 }).lean(),
        TicketEvent.countDocuments({ kind: 'status', from: 'resolu', to: 'ouvert', createdAt: { $gte: from, $lt: to } }),
        TicketEvent.countDocuments({ kind: 'status', from: 'resolu', to: 'ouvert', createdAt: { $gte: prevFrom, $lt: from } }),
        BotConversation.countDocuments({ createdAt: { $gte: from, $lt: to } }),
        BotConversation.countDocuments({ createdAt: { $gte: prevFrom, $lt: from } }),
        BotConversation.countDocuments({ createdAt: { $gte: from, $lt: to }, escalatedTicketId: { $ne: null } }),
        BotConversation.countDocuments({ createdAt: { $gte: prevFrom, $lt: from }, escalatedTicketId: { $ne: null } }),
        Case.countDocuments({ createdAt: { $gte: from, $lt: to } }),
        Case.countDocuments({ resolvedAt: { $gte: from, $lt: to } }),
        Case.countDocuments({ status: { $nin: ['resolved', 'closed'] } }),
        Case.countDocuments({ status: { $nin: ['resolved', 'closed'] }, severity: 'critical' }),
        Approval.countDocuments({ status: 'pending' }),
    ]);

    const created = createdWide.filter((t) => inCur(t.createdAt));
    const createdPrev = createdWide.filter((t) => inPrev(t.createdAt));
    const handled = handledWide.filter((t) => { const h = handledAt(t); return h !== null && inCur(h); });
    const handledPrev = handledWide.filter((t) => { const h = handledAt(t); return h !== null && inPrev(h); });
    const cur = ticketKpis(created, handled);
    const prev = ticketKpis(createdPrev, handledPrev);

    // ---- daily series ----
    const byDay = new Map(days.map((d) => [d, { date: d, created: 0, handled: 0, backlog: 0, firstResponse: [] as number[], resolution: [] as number[] }]));
    for (const t of created) {
        const row = byDay.get(dayKey(new Date(t.createdAt)));
        if (!row) continue;
        row.created++;
        if (t.sla?.firstRespondedAt) row.firstResponse.push((new Date(t.sla.firstRespondedAt).getTime() - new Date(t.createdAt).getTime()) / MIN);
    }
    for (const t of handled) {
        const h = handledAt(t)!;
        const row = byDay.get(dayKey(new Date(h)));
        if (!row) continue;
        row.handled++;
        row.resolution.push((h - new Date(t.createdAt).getTime()) / H);
    }
    // Backlog at the end of each day: created by then, not handled by then.
    const dayEnds = days.map((d, i) => (i + 1 < days.length ? new Date(`${days[i + 1]}T00:00:00+01:00`).getTime() : to.getTime()));
    days.forEach((d, i) => {
        const end = dayEnds[i];
        byDay.get(d)!.backlog = overlapping.filter((t) => new Date(t.createdAt).getTime() < end && (handledAt(t) ?? Infinity) >= end).length;
    });

    // ---- categories: what keeps coming back ----
    const categories = TICKET_CATEGORIES.map((c) => {
        const mine = created.filter((t) => t.category === c.key);
        const before = createdPrev.filter((t) => t.category === c.key).length;
        const res = mine.map((t) => { const h = handledAt(t); return h ? (h - new Date(t.createdAt).getTime()) / H : null; }).filter((v): v is number => v !== null);
        return {
            key: c.key, label: c.label, count: mine.length, prevCount: before, change: change(mine.length, before),
            share: rate(mine.length, created.length),
            resolutionMedianHours: round1(median(res)),
            slaBreachRate: rate(mine.filter((t) => t.sla?.breachedAt).length, mine.length),
            open: mine.filter((t) => OPEN_TICKET_STATUSES.includes(t.status as never)).length,
        };
    }).filter((c) => c.count || c.prevCount).sort((a, b) => b.count - a.count);

    const sources = ['member', 'assistant', 'public'].map((s) => ({ key: s, count: created.filter((t) => t.source === s).length }));

    // ---- agents: who handles what, how fast ----
    const perAgent = new Map<string, { handled: number; first: number[] }>();
    for (const t of handled) {
        if (!t.assigneeId) continue;
        const k = String(t.assigneeId);
        const a = perAgent.get(k) ?? { handled: 0, first: [] };
        a.handled++;
        if (t.sla?.firstRespondedAt) a.first.push((new Date(t.sla.firstRespondedAt).getTime() - new Date(t.createdAt).getTime()) / MIN);
        perAgent.set(k, a);
    }
    const openPerAgent = new Map<string, number>();
    for (const t of openNow) if (t.assigneeId) openPerAgent.set(String(t.assigneeId), (openPerAgent.get(String(t.assigneeId)) ?? 0) + 1);
    const agentIds = [...new Set([...perAgent.keys(), ...openPerAgent.keys()])].filter((id) => Types.ObjectId.isValid(id));
    const agentDocs = await Agent.find({ _id: { $in: agentIds } }, { name: 1 }).lean();
    const agents = agentIds.map((id) => ({
        id, name: agentDocs.find((a) => String(a._id) === id)?.name ?? '—',
        handled: perAgent.get(id)?.handled ?? 0, open: openPerAgent.get(id) ?? 0,
        firstResponseMedianMin: round1(median(perAgent.get(id)?.first ?? [])),
    })).sort((a, b) => b.handled - a.handled);

    // ---- technical errors (member app) ----
    const curDays = days;
    const prevDays = daysOf(prevFrom, from);
    const [errDays, errDaysPrev, membersCur, membersPrev] = await Promise.all([
        ClientErrorDay.find({ day: { $in: curDays } }).lean(),
        ClientErrorDay.find({ day: { $in: prevDays } }, { typeId: 1, count: 1 }).lean(),
        ClientErrorMember.distinct('memberId', { day: { $in: curDays } }),
        ClientErrorMember.distinct('memberId', { day: { $in: prevDays } }),
    ]);
    const typeIds = [...new Set([...errDays, ...errDaysPrev].map((d) => String(d.typeId)))];
    const types = await ClientErrorType.find({ $or: [{ _id: { $in: typeIds } }, { state: { $ne: 'resolved' } }] }).lean();
    const typeById = new Map(types.map((t) => [String(t._id), t]));
    const errClass = (status: number) => (status === 0 ? 'network' : status >= 500 ? 'server' : 'client');
    const errSeries = new Map(curDays.map((d) => [d, { server: 0, client: 0, network: 0 }]));
    const countBy = new Map<string, number>();
    for (const d of errDays) {
        const t = typeById.get(String(d.typeId));
        if (!t) continue;
        errSeries.get(d.day)![errClass(t.status) as 'server' | 'client' | 'network'] += d.count;
        countBy.set(String(d.typeId), (countBy.get(String(d.typeId)) ?? 0) + d.count);
    }
    const prevBy = new Map<string, number>();
    for (const d of errDaysPrev) prevBy.set(String(d.typeId), (prevBy.get(String(d.typeId)) ?? 0) + d.count);
    const membersPerType = await ClientErrorMember.aggregate([
        { $match: { day: { $in: curDays } } }, { $group: { _id: '$typeId', members: { $addToSet: '$memberId' } } }, { $project: { n: { $size: '$members' } } },
    ]);
    const membersBy = new Map(membersPerType.map((m) => [String(m._id), m.n as number]));
    const errorTypes = [...typeById.values()]
        .map((t) => ({
            id: String(t._id), method: t.method, route: t.route, status: t.status, code: t.code ?? null, message: t.lastMessage ?? null,
            count: countBy.get(String(t._id)) ?? 0, prevCount: prevBy.get(String(t._id)) ?? 0, members: membersBy.get(String(t._id)) ?? 0,
            firstSeen: t.firstSeen, lastSeen: t.lastSeen, state: t.state, stateBy: t.stateBy?.name ?? null, note: t.note ?? null,
            regressions: t.regressions ?? 0, hasReplay: Boolean(t.lastReplay?.url),
        }))
        .filter((t) => t.count > 0 || t.state !== 'resolved')
        .sort((a, b) => b.members - a.members || b.count - a.count)
        .slice(0, 30);
    const errTotal = [...countBy.values()].reduce((a, b) => a + b, 0);
    const errTotalPrev = [...prevBy.values()].reduce((a, b) => a + b, 0);
    const resolvedInPeriod = types.filter((t) => t.state === 'resolved' && t.stateAt && inCur(t.stateAt)).length;
    const regressionsInPeriod = types.filter((t) => t.lastRegressionAt && inCur(t.lastRegressionAt)).length;

    const backlogNow = openNow.length;
    const oldestOpen = openNow.reduce<Date | null>((m, t) => (t.createdAt && (!m || new Date(t.createdAt) < m) ? new Date(t.createdAt) : m), null);
    const errors = {
        total: errTotal, prevTotal: errTotalPrev, change: change(errTotal, errTotalPrev),
        membersAffected: membersCur.length, prevMembersAffected: membersPrev.length,
        typesOpen: types.filter((t) => t.state === 'open').length,
        typesHandling: types.filter((t) => t.state === 'handling').length,
        typesResolvedInPeriod: resolvedInPeriod,
        regressions: regressionsInPeriod,
    };

    const kpis = {
        tickets: { ...cur, prev, createdChange: change(cur.created, prev.created), handledChange: change(cur.handled, prev.handled) },
        backlog: { now: backlogNow, oldestOpenHours: oldestOpen ? round1((now.getTime() - oldestOpen.getTime()) / H) : null, unassigned: openNow.filter((t) => !t.assigneeId).length, urgent: openNow.filter((t) => t.priority === 'urgent' || t.priority === 'high').length },
        reopened: { count: reopened, prev: reopenedPrev, rate: rate(reopened, cur.handled) },
        assistant: {
            conversations: bots, prev: botsPrev, escalated, prevEscalated: escalatedPrev,
            settledWithoutAgentRate: bots ? rate(bots - escalated, bots) : null,
            prevSettledWithoutAgentRate: botsPrev ? rate(botsPrev - escalatedPrev, botsPrev) : null,
        },
        cases: { opened: casesOpened, resolved: casesResolved, openNow: casesOpenNow, criticalOpen: casesCritical },
        approvalsPending,
        errors,
    };

    const series = days.map((d) => {
        const r = byDay.get(d)!;
        const e = errSeries.get(d)!;
        return {
            date: d, created: r.created, handled: r.handled, backlog: r.backlog,
            firstResponseMedianHours: r.firstResponse.length ? round1(median(r.firstResponse)! / 60) : null,
            resolutionMedianHours: r.resolution.length ? round1(median(r.resolution)) : null,
            errorsServer: e.server, errorsClient: e.client, errorsNetwork: e.network,
        };
    });

    return {
        period: { from, to, previousFrom: prevFrom, days: days.length },
        kpis, series, categories, sources, agents, errorTypes,
        insights: insights(kpis, categories, errorTypes, series),
    };
}

type K = {
    tickets: { created: number; slaBreachRate: number | null };
    backlog: { unassigned: number };
    reopened: { rate: number | null };
    assistant: { settledWithoutAgentRate: number | null; conversations: number; escalated: number };
    errors: { regressions: number };
};
type Cat = { label: string; share: number | null; count: number; change: number | null };
type E = { count: number; state: string; members: number; method: string; route: string; status: number };
type S = { backlog: number };

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** A few plain sentences that point at a decision: where it hurts and what changed. */
function insights(k: K, categories: Cat[], errors: E[], series: S[]) {
    const out: { tone: 'good' | 'warning' | 'critical' | 'info'; text: string }[] = [];
    const t = k.tickets;
    const top = categories[0];
    if (top && t.created >= 5) {
        out.push({
            tone: top.change !== null && top.change >= 25 ? 'warning' : 'info',
            text: `« ${top.label} » représente ${fr(top.share ?? 0)} % des demandes (${top.count})${top.change !== null ? `, ${top.change >= 0 ? '+' : '−'}${fr(Math.abs(top.change))} % par rapport à la période précédente` : ''}.`,
        });
    }
    if (t.slaBreachRate !== null && t.slaBreachRate >= 10) {
        out.push({ tone: t.slaBreachRate >= 25 ? 'critical' : 'warning', text: `${fr(t.slaBreachRate)} % des demandes ont dépassé leur délai (SLA) : renforcer l’équipe aux heures de pointe ou revoir les priorités.` });
    }
    const first = series[0]?.backlog ?? 0;
    const last = series[series.length - 1]?.backlog ?? 0;
    if (last > first && last - first >= 3) {
        out.push({ tone: 'warning', text: `Le stock de demandes en attente monte (${first} → ${last}) : il arrive plus de demandes qu’il n’en est traité.` });
    } else if (first > last && first - last >= 3) {
        out.push({ tone: 'good', text: `Le stock de demandes en attente baisse (${first} → ${last}).` });
    }
    if (k.backlog.unassigned >= 3) out.push({ tone: 'warning', text: `${k.backlog.unassigned} demandes ouvertes n’ont aucun agent attribué.` });
    const worst = errors.find((e) => e.count > 0 && e.state !== 'resolved');
    if (worst && worst.members > 0) {
        out.push({
            tone: worst.status === 0 || worst.status >= 500 ? 'critical' : 'warning',
            text: `L’erreur la plus répandue (${worst.method} ${worst.route} → ${worst.status || 'réseau'}) a touché ${worst.members} membre${worst.members > 1 ? 's' : ''} (${worst.count} fois).`,
        });
    }
    if (k.errors.regressions > 0) out.push({ tone: 'critical', text: `${k.errors.regressions} erreur${k.errors.regressions > 1 ? 's' : ''} marquée${k.errors.regressions > 1 ? 's' : ''} « corrigée » est revenue : à revoir.` });
    if (k.assistant.settledWithoutAgentRate !== null && k.assistant.conversations >= 10) {
        out.push({
            tone: k.assistant.settledWithoutAgentRate >= 60 ? 'good' : 'info',
            text: `L’assistant a réglé ${fr(k.assistant.settledWithoutAgentRate)} % des questions sans agent (${k.assistant.conversations - k.assistant.escalated} sur ${k.assistant.conversations}).`,
        });
    }
    if (k.reopened.rate !== null && k.reopened.rate >= 10) out.push({ tone: 'warning', text: `${fr(k.reopened.rate)} % des demandes résolues ont été rouvertes par le membre : la réponse ne réglait pas le problème.` });
    return out.slice(0, 6);
}
