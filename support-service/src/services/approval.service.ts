import { Types } from 'mongoose';
import { Approval, ApprovalType, AgentRef, IApproval } from '../database/models/approval.model';
import { Permission } from '../config/permissions';
import { AppError, conflict, DependencyError, forbidden, notFound } from '../utils/errors';
import { audit } from './audit.service';
import { notifyAgents } from './notifier.service';
import { assertNoConflict } from './scope.service';
import { notifyManagers } from './ntfy.service';
import { hasPermission } from '../config/permissions';

/**
 * Double validation (CONTRACT §4): a request by one agent, approved by a
 * different agent holding the approve permission, then executed. Every step
 * is a conditional write on the expected status.
 */

export const APPROVAL_PERMISSIONS: Record<ApprovalType, { request: Permission; approve: Permission; approverRoles: string[]; label: string }> = {
    contact_change: { request: 'members.contact.request', approve: 'members.contact.approve', approverRoles: ['finance_manager', 'support_admin'], label: 'Changement d’email ou de téléphone' },
    manual_activation: { request: 'activation.manual.request', approve: 'activation.manual.approve', approverRoles: ['finance_manager', 'support_admin'], label: 'Activation de secours' },
    regularization: { request: 'finance.regularize.request', approve: 'finance.regularize.approve', approverRoles: ['finance_manager'], label: 'Régularisation de retrait' },
    // Security plan Phase 5.
    authenticator_reset: { request: 'authenticator.reset.request', approve: 'authenticator.reset.approve', approverRoles: ['finance_manager'], label: 'Réinitialisation de l’application d’authentification' },
    account_freeze: { request: 'risk.decide', approve: 'risk.decide', approverRoles: ['finance_manager'], label: 'Gel ou dégel de l’argent d’un compte' },
    // Security plan Phase 4, blocking mode (2026-11-22): a member held by the fraud engine.
    risk_release: { request: 'risk.decide', approve: 'risk.decide', approverRoles: ['finance_manager'], label: 'Libérer un compte retenu par le moteur de fraude' },
};

export interface ExecutionOutcome { ok: boolean; code?: string; message?: string; result?: unknown }
/** null = nothing to run now: the request stays `approved` (email/phone change: send-code then apply). */
type Executor = (a: IApproval & { _id: Types.ObjectId }, by: AgentRef) => Promise<ExecutionOutcome | null>;
const executors: Partial<Record<ApprovalType, Executor>> = {};

export function registerExecutor(type: ApprovalType, fn: Executor): void { executors[type] = fn; }

const PENDING_TTL_MS = 7 * 24 * 3600 * 1000;

export async function createApproval(args: {
    type: ApprovalType; requestedBy: AgentRef; reason: string; payload: Record<string, unknown>;
    subject?: IApproval['subject']; ticketId?: string | null; caseId?: string | null; requiredApprovals?: number;
}, ctx: { ip?: string; userAgent?: string } = {}) {
    // Phase 5: never a request about one's own account or referral tree.
    await assertNoConflict(args.requestedBy, args.subject?.userId, { ...ctx, action: `approval.request.${args.type}` });
    const doc = await Approval.create({
        type: args.type, status: 'pending', requestedBy: args.requestedBy, reason: args.reason, payload: args.payload,
        subject: args.subject ?? {}, requiredApprovals: args.requiredApprovals ?? 1, approvals: [],
        ticketId: args.ticketId && Types.ObjectId.isValid(args.ticketId) ? args.ticketId : null,
        caseId: args.caseId && Types.ObjectId.isValid(args.caseId) ? args.caseId : null,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });
    await audit({
        actor: { type: 'agent', ...args.requestedBy }, action: `approval.requested`, target: { type: 'approval', id: String(doc._id) },
        after: { type: args.type, subject: args.subject ?? {}, payload: redactPayload(args.payload) }, reason: args.reason, ...ctx,
    });
    const perms = APPROVAL_PERMISSIONS[args.type];
    for (const role of perms.approverRoles) {
        await notifyAgents({
            role, kind: 'approval.pending', title: 'Demande à valider', body: `${perms.label} demandée par ${args.requestedBy.name}.`,
            link: `/approvals/${doc._id}`, dedupKey: `approval:${doc._id}:${role}`,
        });
    }
    return doc;
}

/** Contact values never go into the audit in clear. */
function redactPayload(p: Record<string, unknown>) {
    const out = { ...p };
    if ('newValue' in out) out.newValue = '[masqué]';
    if ('momoNumber' in out) out.momoNumber = '[masqué]';
    return out;
}

async function runExecutor(approval: IApproval & { _id: Types.ObjectId }, by: AgentRef, ctx: { ip?: string; userAgent?: string }) {
    const exec = executors[approval.type];
    if (!exec) return approval; // nothing to run now (contact change: send-code/apply follow)
    let outcome: ExecutionOutcome | null;
    try {
        outcome = await exec(approval, by);
    } catch (err) {
        if (err instanceof DependencyError) {
            // Owner service down: stays approved, can be executed again later.
            await Approval.updateOne({ _id: approval._id, status: 'approved' }, { $set: { execution: { at: new Date(), by, ok: false, code: 'SERVICE_UNAVAILABLE', message: err.message } } });
            await audit({ actor: { type: 'agent', ...by }, action: 'approval.execute_unavailable', result: 'error', target: { type: 'approval', id: String(approval._id) }, ...ctx });
            return Approval.findById(approval._id).lean();
        }
        throw err;
    }
    if (!outcome) return Approval.findById(approval._id).lean();
    const status = outcome.ok ? 'executed' : 'failed';
    await Approval.updateOne({ _id: approval._id, status: 'approved' }, {
        $set: { status, execution: { at: new Date(), by, ok: outcome.ok, code: outcome.code ?? null, message: outcome.message ?? null, result: outcome.result ?? null } },
    });
    await audit({
        actor: { type: 'agent', ...by }, action: outcome.ok ? 'approval.executed' : 'approval.execution_failed', result: outcome.ok ? 'ok' : 'error',
        target: { type: 'approval', id: String(approval._id) }, after: { status, code: outcome.code ?? null }, ...ctx,
    });
    return Approval.findById(approval._id).lean();
}

const OVERRIDE_REASON_MIN = 20;

/**
 * Approves a request. A second agent with the approve permission is the rule
 * (SELF_APPROVAL otherwise). A super manager (approvals.override) approves
 * alone, own requests included, with safeguards (Security plan Phase 5): a
 * fresh authenticator code (the route's single-use reauth), a written reason
 * of 20 characters at least, an instant alert to the other managers, and never
 * on their own account or referral tree (checked for every approver).
 */
export async function approve(id: string, approver: AgentRef, note: string | undefined, ctx: { ip?: string; userAgent?: string } = {}) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const current = await Approval.findById(id).lean();
    if (!current) throw notFound('Demande introuvable.');
    await assertNoConflict(approver, current.subject?.userId, { ...ctx, action: 'approval.approve' });
    const override = hasPermission(approver.roles, 'approvals.override');
    if (override && (note ?? '').trim().length < OVERRIDE_REASON_MIN) {
        throw new AppError(400, `Validation seule : indiquez le motif (${OVERRIDE_REASON_MIN} caractères au moins).`, 'REASON_REQUIRED');
    }
    if (!override && current.requestedBy.id === approver.id) {
        await audit({ actor: { type: 'agent', ...approver }, action: 'approval.self_approval_refused', result: 'denied', target: { type: 'approval', id }, ...ctx });
        throw forbidden('Vous ne pouvez pas valider votre propre demande.', 'SELF_APPROVAL');
    }
    if (current.status !== 'pending') throw conflict('Cette demande n’est plus en attente.', 'NOT_PENDING');
    if (current.expiresAt.getTime() < Date.now()) {
        await Approval.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'expired' } });
        throw conflict('Cette demande a expiré.', 'EXPIRED');
    }
    const guard: Record<string, unknown> = { _id: id, status: 'pending', 'approvals.agent.id': { $ne: approver.id } };
    if (!override) guard['requestedBy.id'] = { $ne: approver.id };
    const updated = await Approval.findOneAndUpdate(
        guard,
        { $push: { approvals: { agent: approver, at: new Date(), note: note ?? null, ...(override ? { override: true } : {}) } } },
        { new: true },
    ).lean();
    if (!updated) throw conflict('Cette demande n’est plus en attente, ou vous l’avez déjà validée.', 'NOT_PENDING');
    await audit({
        actor: { type: 'agent', ...approver }, action: override ? 'approval.super_override' : 'approval.approved', target: { type: 'approval', id },
        reason: note ?? null, after: { approvals: updated.approvals.length, required: updated.requiredApprovals, override, ownRequest: updated.requestedBy.id === approver.id }, ...ctx,
    });
    if (override) await alertOverride(updated as any, approver, note ?? '');
    else if (updated.approvals.length < updated.requiredApprovals) return updated;
    const r = await Approval.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'approved' } });
    if (r.modifiedCount !== 1) return Approval.findById(id).lean();
    return runExecutor({ ...updated, status: 'approved' } as any, approver, ctx);
}

/** Every other manager hears about a lone approval at once: in the desk, by e-mail and on their phones. */
async function alertOverride(a: IApproval & { _id: Types.ObjectId }, by: AgentRef, reason: string) {
    const label = APPROVAL_PERMISSIONS[a.type].label;
    const body = `${by.name} a validé seul : ${label}${a.subject?.userId ? ` (membre ${a.subject.userId})` : ''}. Motif : ${reason.slice(0, 300)}`;
    for (const role of ['finance_manager', 'support_admin', 'super_manager']) {
        await notifyAgents({ role, kind: 'approval.super_override', title: 'Validation seule (super responsable)', body, link: `/approvals/${a._id}`, dedupKey: `override:${a._id}:${role}`, email: true });
    }
    notifyManagers({ title: `Validation seule · ${label}`, message: body, priority: 5, click: `/approvals/${a._id}` });
}

/** Retries the execution of an approved request whose owner service was down. */
export async function executeAgain(id: string, by: AgentRef, ctx: { ip?: string; userAgent?: string } = {}) {
    const a = await Approval.findById(id).lean();
    if (!a) throw notFound('Demande introuvable.');
    if (a.status !== 'approved' || !executors[a.type]) throw conflict('Cette demande ne peut pas être exécutée maintenant.', 'NOT_EXECUTABLE');
    if (a.requestedBy.id === by.id && !hasPermission(by.roles, 'approvals.override')) throw forbidden('Vous ne pouvez pas exécuter votre propre demande.', 'SELF_APPROVAL');
    await assertNoConflict(by, a.subject?.userId, { ...ctx, action: 'approval.execute' });
    return runExecutor(a as any, by, ctx);
}

export async function reject(id: string, agent: AgentRef, reason: string, ctx: { ip?: string; userAgent?: string } = {}) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const a = await Approval.findById(id).lean();
    if (!a) throw notFound('Demande introuvable.');
    if (a.requestedBy.id === agent.id) throw forbidden('Annulez votre demande au lieu de la refuser.', 'SELF_APPROVAL');
    await assertNoConflict(agent, a.subject?.userId, { ...ctx, action: 'approval.reject' });
    const updated = await Approval.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { status: 'rejected', rejectedBy: agent, rejectionReason: reason } },
        { new: true },
    ).lean();
    if (!updated) throw conflict('Cette demande n’est plus en attente.', 'NOT_PENDING');
    await audit({ actor: { type: 'agent', ...agent }, action: 'approval.rejected', target: { type: 'approval', id }, reason, ...ctx });
    await notifyAgents({ agentId: a.requestedBy.id, kind: 'approval.rejected', title: 'Demande refusée', body: `${APPROVAL_PERMISSIONS[a.type].label} : refusée par ${agent.name}.`, link: `/approvals/${id}` });
    return updated;
}

export async function cancel(id: string, agent: AgentRef, ctx: { ip?: string; userAgent?: string } = {}) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const updated = await Approval.findOneAndUpdate(
        { _id: id, status: 'pending', 'requestedBy.id': agent.id }, { $set: { status: 'cancelled' } }, { new: true },
    ).lean();
    if (!updated) throw conflict('Seul le demandeur peut annuler une demande en attente.', 'NOT_PENDING');
    await audit({ actor: { type: 'agent', ...agent }, action: 'approval.cancelled', target: { type: 'approval', id }, ...ctx });
    return updated;
}

export function assertApprovalType(t: unknown): asserts t is ApprovalType {
    if (typeof t !== 'string' || !(t in APPROVAL_PERMISSIONS)) throw new AppError(400, 'Type de demande inconnu.', 'BAD_TYPE');
}
