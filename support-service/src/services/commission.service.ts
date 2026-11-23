import { Approval, AgentRef } from '../database/models/approval.model';
import { badRequest, conflict, notFound } from '../utils/errors';
import { createApproval, registerExecutor } from './approval.service';
import { getSupportMember } from './clients/user.client';
import { getCommission, reverseCommission } from './clients/payment.client';

/**
 * Commission reversal (Security plan Phase 5 leftover, 2026-11-23).
 *
 * A finance agent or manager cites the commission deposit (its transaction id) and says why;
 * another finance manager approves (reauth, never one's own request, never on one's own
 * account or referral tree: approval.service). payment-service then takes the money back
 * once: the deposit becomes RECONCILED, the same amount leaves the member's AVAILABLE balance
 * under the ledger reference `commission-reversal:<txId>`. If the member no longer has it, the
 * reversal is refused (nothing debited, no debt created) and the approval ends `failed` with
 * the reason; freezing the account is the other answer. The member is not notified
 * automatically: the agent answers in the ticket.
 */

type Ctx = { ip?: string; userAgent?: string };
const REASON_MIN = 20;
const MEMBER_ID = /^[a-f0-9]{24}$/i;
const TX_ID = /^[A-Za-z0-9_-]{6,64}$/;
const optId = (v: unknown) => (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? v : null);

export async function previewCommission(userId: string, transactionId: string) {
    if (!MEMBER_ID.test(userId) || !TX_ID.test(transactionId)) throw notFound('Commission introuvable.');
    const c = await getCommission(transactionId, userId);
    if (!c) throw notFound('Aucune transaction de ce membre avec cette référence.');
    return c;
}

export async function requestCommissionReversal(
    userId: string,
    input: { transactionId?: unknown; reason?: unknown; ticketId?: unknown; caseId?: unknown },
    by: AgentRef,
    ctx: Ctx,
) {
    const transactionId = typeof input.transactionId === 'string' ? input.transactionId.trim() : '';
    if (!TX_ID.test(transactionId)) throw badRequest('Indiquez la référence de la commission (transaction).', 'TRANSACTION_REQUIRED');
    if (!MEMBER_ID.test(userId) || !(await getSupportMember(userId))) throw notFound('Membre introuvable.');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 2000) : '';
    if (reason.length < REASON_MIN) throw badRequest(`Expliquez pourquoi reprendre cette commission (${REASON_MIN} caractères au moins).`, 'REASON_REQUIRED');

    const c = await previewCommission(userId, transactionId);
    if (!c.isCommission) throw conflict('Cette transaction n’est pas une commission.', 'NOT_A_COMMISSION');
    if (c.reversed) throw conflict('Cette commission a déjà été reprise.', 'ALREADY_REVERSED');
    if (!c.reversible) throw conflict(`Cette commission ne peut pas être reprise (statut « ${c.status} »).`, 'NOT_REVERSIBLE');
    if (await Approval.exists({ type: 'commission_reversal', 'subject.transactionId': transactionId, status: { $in: ['pending', 'approved'] } })) {
        throw conflict('Une demande de reprise est déjà en cours pour cette commission.', 'ALREADY_PENDING');
    }
    return createApproval({
        type: 'commission_reversal', requestedBy: by, reason,
        payload: { amount: c.amount, currency: c.currency, level: c.level, sourceUserId: c.sourceUserId, paidAt: c.createdAt },
        subject: { userId, transactionId }, ticketId: optId(input.ticketId), caseId: optId(input.caseId),
    }, ctx);
}

registerExecutor('commission_reversal', async (a) => {
    const r = await reverseCommission(a.subject.transactionId!, {
        userId: a.subject.userId!, reason: a.reason.slice(0, 1000), approvalId: String(a._id),
    });
    return r.ok
        ? { ok: true, result: r.data ?? null }
        : { ok: false, code: r.code ?? 'REFUSED', message: r.message ?? 'Refusé par le service des paiements.' };
});
