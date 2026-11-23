import { Types, FilterQuery } from 'mongoose';
import { CASE_SEVERITIES, CASE_STATUSES, CASE_TYPES, CaseSeverity, CaseStatus, FRAUD_CASE_TYPES, isFraudCase } from '../config/constants';
import { memberCountry, teamFilter } from './scope.service';
import { notifyManagers } from './ntfy.service';
import { Case, ICase } from '../database/models/case.model';
import { Agent } from '../database/models/agent.model';
import { badRequest, conflict, notFound } from '../utils/errors';
import { currentRequestId } from '../utils/request-context';
import { recheckPayin, recheckWithdrawal, RecheckResult } from './clients/payment.client';
import { notifyAgents } from './notifier.service';

const SEVERITY_RANK: Record<CaseSeverity, number> = { info: 0, warning: 1, critical: 2 };

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export interface CaseInput {
    type: unknown; dedupKey: unknown; severity?: unknown; summary: unknown; details?: unknown;
    subject?: { userId?: unknown; transactionId?: unknown; sessionId?: unknown; gateway?: unknown };
    /** Phase 5: the member's country (else looked up) and the money at stake (XAF). */
    country?: unknown; amount?: unknown;
    /** false: file the case without alerting anyone (Phase 4 look-back over past data, which
     *  would otherwise ring the managers once per historical case). Default true. */
    alert?: unknown;
}

/**
 * Opens a case, idempotent on dedupKey (unique index): the same anomaly
 * reported twice is one case whose occurrence count grows, and whose severity
 * only ever goes up.
 */
export async function upsertCase(input: CaseInput, source: string): Promise<{ caseId: string; created: boolean }> {
    const type = String(input.type);
    if (!CASE_TYPES.includes(type as any)) throw badRequest('Unknown case type', 'BAD_TYPE');
    const dedupKey = str(input.dedupKey, 300);
    if (!dedupKey) throw badRequest('dedupKey required', 'BAD_DEDUP_KEY');
    const alert = input.alert !== false;
    const severity = (CASE_SEVERITIES.includes(input.severity as any) ? input.severity : 'warning') as CaseSeverity;
    const summary = str(input.summary, 1000);
    if (!summary) throw badRequest('summary required', 'BAD_SUMMARY');
    const subject = {
        userId: str(input.subject?.userId, 64) ?? null, transactionId: str(input.subject?.transactionId, 100) ?? null,
        sessionId: str(input.subject?.sessionId, 100) ?? null, gateway: str(input.subject?.gateway, 40) ?? null,
    };
    const now = new Date();
    const givenCountry = typeof input.country === 'string' && /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : null;
    const amountNum = Number(input.amount);
    const amount = Number.isFinite(amountNum) && amountNum >= 0 ? Math.round(amountNum * 100) / 100 : null;
    let country: string | null | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
        // Looked up once, only for a case that may be new (country teams, Phase 5).
        if (country === undefined) country = givenCountry ?? (await Case.exists({ dedupKey }) ? null : await memberCountry(subject.userId));
        try {
            const res = await Case.findOneAndUpdate(
                { dedupKey },
                {
                    $setOnInsert: {
                        type, dedupKey, status: 'open', subject, summary, details: input.details ?? null, source, severity,
                        severityRank: SEVERITY_RANK[severity], country: country ?? null,
                        checks: [], comments: [], history: [{ at: now, kind: 'opened', by: source }], createdAt: now,
                    },
                    $set: { lastSeenAt: now, ...(amount !== null ? { amount } : {}) },
                    $inc: { occurrences: 1 },
                },
                { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: false, timestamps: false },
            );
            const doc = res.value!;
            const created = !res.lastErrorObject?.updatedExisting;
            if (created) {
                // $inc on insert starts at 1; make updatedAt consistent.
                await Case.updateOne({ _id: doc._id }, { $set: { updatedAt: now } });
                if (alert) await alertForCase(doc, severity);
            } else if (SEVERITY_RANK[severity] > SEVERITY_RANK[doc.severity as CaseSeverity]) {
                const r = await Case.updateOne({ _id: doc._id, severity: doc.severity }, {
                    $set: { severity, severityRank: SEVERITY_RANK[severity] }, $push: { history: { at: now, kind: 'severity', by: source, from: doc.severity, to: severity } },
                });
                if (r.modifiedCount === 1 && alert) await alertForCase(doc, severity);
            }
            return { caseId: String(doc._id), created };
        } catch (err: any) {
            if (err?.code === 11000 && attempt < 2) continue; // concurrent first insert: retry as an update
            throw err;
        }
    }
    throw new Error('unreachable');
}

async function alertForCase(doc: { _id: unknown; type: string; summary: string }, severity: CaseSeverity) {
    // Fraud cases go to finance managers only (Phase 5); a critical one also rings their phones.
    // An account suspended on a withdrawal (2026-11-23) also reaches the support administrators,
    // who may lift it (members.unban), and is e-mailed even as a warning (log mode) is not.
    const banCase = doc.type === 'no_referral_withdrawal_ban';
    const roles = doc.type === 'activation' ? ['support_agent']
        : banCase && severity === 'critical' ? ['finance_manager', 'support_admin', 'super_manager']
        : isFraudCase(doc.type) || severity === 'critical' ? ['finance_manager'] : ['finance_agent'];
    if (isFraudCase(doc.type) && severity === 'critical') {
        notifyManagers({
            title: banCase ? 'Compte suspendu automatiquement (retrait sans filleul)' : 'Dossier fraude critique',
            message: doc.summary.slice(0, banCase ? 600 : 300), priority: 5, click: `/cases/${doc._id}`,
        });
    }
    for (const role of roles) {
        await notifyAgents({
            role, kind: `case.${severity}`, title: banCase && severity === 'critical' ? 'Compte suspendu : retrait sans filleul' : severity === 'critical' ? 'Dossier critique' : 'Nouveau dossier',
            body: doc.summary.slice(0, 160), link: `/cases/${doc._id}`, dedupKey: `case:${doc._id}:${role}:${severity}`,
            email: severity === 'critical',
        });
    }
}

export async function listCases(q: Record<string, unknown>, agentId: string, team?: string[]) {
    // Phase 5: a country team sees only its countries' cases.
    const filter: FilterQuery<ICase> = { ...teamFilter(team) } as FilterQuery<ICase>;
    const fraud = q.type === 'fraud';
    if (fraud) filter.type = { $in: FRAUD_CASE_TYPES };
    else if (q.type === 'finance') filter.type = { $nin: ['activation', ...FRAUD_CASE_TYPES] };
    else if (typeof q.type === 'string' && CASE_TYPES.includes(q.type as any)) filter.type = q.type;
    if (typeof q.status === 'string') {
        if (q.status === 'active') filter.status = { $in: ['open', 'in_progress', 'waiting_provider'] };
        else if (CASE_STATUSES.includes(q.status as any)) filter.status = q.status;
    }
    if (typeof q.severity === 'string' && CASE_SEVERITIES.includes(q.severity as any)) filter.severity = q.severity;
    if (q.assignee === 'me') filter.assigneeId = new Types.ObjectId(agentId);
    else if (q.assignee === 'unassigned') filter.assigneeId = null;
    else if (typeof q.assignee === 'string' && Types.ObjectId.isValid(q.assignee)) filter.assigneeId = new Types.ObjectId(q.assignee);
    if (typeof q.userId === 'string' && /^[a-f0-9]{24}$/i.test(q.userId)) filter['subject.userId'] = q.userId;
    const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(q.limit || '30'), 10) || 30));
    const [items, total] = await Promise.all([
        // The fraud queue: worst first, then the largest amount (index {status, severityRank, amount}).
        Case.find(filter, { checks: 0, comments: 0, history: 0 })
            .sort(fraud ? { severityRank: -1, amount: -1, createdAt: -1 } : { severityRank: -1, createdAt: -1 })
            .skip((page - 1) * limit).limit(limit).lean(),
        Case.countDocuments(filter),
    ]);
    return { items, total, page, limit };
}

export async function getCase(id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const c = await Case.findById(id).lean();
    if (!c) throw notFound('Dossier introuvable.');
    return c;
}

export async function assignCase(id: string, by: { id: string; name: string }, assigneeId: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    let to: Types.ObjectId | null = null;
    if (assigneeId !== null) {
        if (typeof assigneeId !== 'string' || !Types.ObjectId.isValid(assigneeId)) throw badRequest('Agent inconnu.', 'BAD_AGENT');
        const a = await Agent.findOne({ _id: assigneeId, status: 'active' }, { _id: 1 }).lean();
        if (!a) throw badRequest('Agent inconnu ou inactif.', 'BAD_AGENT');
        to = a._id as Types.ObjectId;
    }
    const before = await Case.findByIdAndUpdate(id, {
        $set: { assigneeId: to }, $push: { history: { at: new Date(), kind: 'assigned', by: by.id, to: to ? String(to) : null } },
    }).lean();
    if (!before) throw notFound('Dossier introuvable.');
    if (to && String(to) !== by.id) await notifyAgents({ agentId: String(to), kind: 'case.assigned', title: 'Dossier attribué', body: before.summary.slice(0, 160), link: `/cases/${id}` });
    return { before: before.assigneeId ? String(before.assigneeId) : null, after: to ? String(to) : null };
}

export async function commentCase(id: string, by: { id: string; name: string }, body: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const text = str(body, 5000);
    if (!text) throw badRequest('Commentaire vide.', 'BAD_BODY');
    const r = await Case.updateOne({ _id: id }, { $push: { comments: { at: new Date(), agentId: by.id, name: by.name, body: text } } });
    if (r.matchedCount !== 1) throw notFound('Dossier introuvable.');
    return getCase(id);
}

export async function setCaseStatus(id: string, by: { id: string }, status: unknown, note?: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (typeof status !== 'string' || !CASE_STATUSES.includes(status as CaseStatus)) throw badRequest('Statut inconnu.', 'BAD_STATUS');
    const before = await Case.findOneAndUpdate({ _id: id, status: { $ne: status } }, {
        $set: { status, ...(status === 'resolved' || status === 'closed' ? { resolvedAt: new Date() } : {}) },
        $push: { history: { at: new Date(), kind: 'status', by: by.id, to: status, note: note ?? null } },
    }).lean();
    if (!before) throw conflict('Le dossier a déjà ce statut, ou n’existe pas.', 'NO_CHANGE');
    await Case.updateOne({ _id: id, 'history.kind': 'status' }, { $set: { 'history.$[h].from': before.status } }, { arrayFilters: [{ 'h.kind': 'status', 'h.from': null, 'h.to': status }] }).catch(() => undefined);
    return { before: before.status, after: status };
}

/** Asks the provider again through payment-service and keeps the normalised answer on the case. */
export async function recheckCase(id: string, by: { id: string }) {
    const c = await getCase(id);
    let result: RecheckResult;
    if (c.subject?.transactionId) result = await recheckWithdrawal(c.subject.transactionId);
    else if (c.subject?.sessionId) result = await recheckPayin(c.subject.sessionId);
    else throw badRequest('Ce dossier n’a ni retrait ni paiement à revérifier.', 'NOTHING_TO_CHECK');
    await Case.updateOne({ _id: id }, { $push: { checks: { at: new Date(), by: by.id, source: 'payment-service', result, requestId: result.requestId ?? currentRequestId() ?? null } } });
    return { result, case: await getCase(id) };
}

export async function recordCheck(caseId: string, by: string, result: unknown) {
    await Case.updateOne({ _id: caseId }, { $push: { checks: { at: new Date(), by, source: 'payment-service', result, requestId: currentRequestId() ?? null } } });
}
