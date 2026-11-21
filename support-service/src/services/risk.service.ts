import { Approval, AgentRef } from '../database/models/approval.model';
import { badRequest, conflict, notFound } from '../utils/errors';
import { createApproval, registerExecutor } from './approval.service';
import { changeMemberMomo, freezeMember, getSupportMember, resetMemberAuthenticator } from './clients/user.client';

/**
 * Security plan Phase 5: support actions on a member's security, each one a
 * request approved by another agent (or a super manager alone), then executed
 * by user-service, which owns the account.
 *   - authenticator_reset: lost phone, after ID + selfie (support agent asks, finance manager approves).
 *   - account_freeze: freeze or unfreeze the member's money (finance managers).
 *   - contact_change with field 'momo': new Mobile Money number + operator (applied at approval).
 */

type Ctx = { ip?: string; userAgent?: string };
const REASON_MIN = 20;
const MEMBER_ID = /^[a-f0-9]{24}$/i;

function reasonOf(v: unknown, hint: string): string {
    const r = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
    if (r.length < REASON_MIN) throw badRequest(`${hint} (${REASON_MIN} caractères au moins).`, 'REASON_REQUIRED');
    return r;
}

async function assertMember(userId: string) {
    if (!MEMBER_ID.test(userId)) throw notFound('Membre introuvable.');
    const m = await getSupportMember(userId);
    if (!m) throw notFound('Membre introuvable.');
    return m;
}

async function assertNoneOpen(type: string, userId: string) {
    if (await Approval.exists({ type, 'subject.userId': userId, status: { $in: ['pending', 'approved'] } })) {
        throw conflict('Une demande du même type est déjà en cours pour ce membre.', 'ALREADY_PENDING');
    }
}

const optId = (v: unknown) => (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? v : null);

export async function requestAuthenticatorReset(userId: string, input: { reason?: unknown; ticketId?: unknown }, by: AgentRef, ctx: Ctx) {
    await assertMember(userId);
    const reason = reasonOf(input.reason, 'Décrivez la vérification faite (pièce d’identité + selfie)');
    await assertNoneOpen('authenticator_reset', userId);
    return createApproval({ type: 'authenticator_reset', requestedBy: by, reason, payload: {}, subject: { userId }, ticketId: optId(input.ticketId) }, ctx);
}

export async function requestFreeze(userId: string, input: { action?: unknown; reason?: unknown; caseId?: unknown; ticketId?: unknown }, by: AgentRef, ctx: Ctx) {
    const action = input.action === 'unfreeze' ? 'unfreeze' : input.action === 'freeze' ? 'freeze' : null;
    if (!action) throw badRequest('Action inconnue (freeze ou unfreeze).', 'BAD_ACTION');
    const m = await assertMember(userId);
    if (action === 'unfreeze' && !m.frozen) throw conflict('L’argent de ce compte n’est pas gelé.', 'NOT_FROZEN');
    if (action === 'freeze' && m.frozen) throw conflict('L’argent de ce compte est déjà gelé.', 'ALREADY_FROZEN');
    const reason = reasonOf(input.reason, action === 'freeze' ? 'Expliquez pourquoi geler cet argent' : 'Expliquez pourquoi lever le gel');
    await assertNoneOpen('account_freeze', userId);
    return createApproval({
        type: 'account_freeze', requestedBy: by, reason, payload: { action }, subject: { userId },
        caseId: optId(input.caseId), ticketId: optId(input.ticketId),
    }, ctx);
}

const ownerOutcome = (r: { ok: boolean; code?: string; message?: string; data?: unknown }) =>
    r.ok ? { ok: true, result: r.data ?? null } : { ok: false, code: r.code ?? 'REFUSED', message: r.message ?? 'Refusé par le service des comptes.' };

registerExecutor('authenticator_reset', async (a) =>
    ownerOutcome(await resetMemberAuthenticator({ userId: a.subject.userId!, reason: a.reason.slice(0, 300), approvalId: String(a._id) })));

registerExecutor('account_freeze', async (a) =>
    ownerOutcome(await freezeMember({
        userId: a.subject.userId!, action: (a.payload as { action: 'freeze' | 'unfreeze' }).action,
        reason: a.reason.slice(0, 300), approvalId: String(a._id),
    })));

/** Email/phone changes continue with a code to the new contact (member.service); a MoMo change applies here. */
registerExecutor('contact_change', async (a) => {
    const p = a.payload as { field?: string; momoNumber?: string; momoOperator?: string };
    if (p.field !== 'momo') return null;
    return ownerOutcome(await changeMemberMomo({ userId: a.subject.userId!, momoNumber: p.momoNumber!, momoOperator: p.momoOperator!, approvalId: String(a._id) }));
});
