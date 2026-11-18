import { PAYIN_STATUS_LABELS } from '../config/constants';
import { Case } from '../database/models/case.model';
import { Ticket } from '../database/models/ticket.model';
import { badRequest, notFound } from '../utils/errors';
import { lookupPayin, manualActivation, memberPayins, Payin, recheckPayin, RecheckResult } from './clients/payment.client';
import { getSupportMember } from './clients/user.client';
import { registerExecutor } from './approval.service';
import { recordCheck, upsertCase } from './case.service';
import { createTicket } from './ticket.service';
import { Types } from 'mongoose';

/**
 * Activation after payment (CdC §4). The support never activates anything
 * itself: it asks payment-service to re-check with the provider (which replays
 * the real webhook handler on `confirmed`), or, for a manual activation,
 * asks payment-service to verify the external reference — after approval.
 */

const PAID_PACKS = ['CLASSIQUE', 'CIBLE', 'WINNER'];

export async function memberActivationStatus(userId: string) {
    const [member, payins] = await Promise.all([getSupportMember(userId), memberPayins(userId, 20)]);
    const subs = member?.subscriptions ?? [];
    const active = subs.find((s) => s.status === 'active' && PAID_PACKS.includes(String(s.type).toUpperCase()));
    return {
        activated: Boolean(active),
        subscription: active ? { type: active.type, status: active.status, startDate: active.startDate ?? null, endDate: active.endDate ?? null } : null,
        payins: payins.map((p) => ({
            sessionId: p.sessionId, gateway: p.gateway, status: p.status, purpose: p.purpose ?? null, createdAt: p.createdAt,
            amount: p.amount, currency: p.currency,
        })),
    };
}

type MemberCheckResult = RecheckResult['result'] | 'not_finished';

const memberMessage = (r: MemberCheckResult) => ({
    not_finished: 'Ce paiement n’a pas été terminé : il n’a jamais été validé chez un opérateur, donc aucun argent n’a pu être prélevé. Pour activer votre compte, payez à nouveau votre pack. Si de l’argent a quand même été débité, dites-le-nous ci-dessous.',
    confirmed: 'Votre paiement est confirmé. Votre compte est en cours d’activation : rechargez l’application dans une minute.',
    pending: 'L’opérateur n’a pas encore confirmé votre paiement. Nous revérifierons automatiquement ; réessayez plus tard.',
    failed: 'L’opérateur indique que ce paiement a échoué ou a été annulé. Aucune activation n’est possible avec ce paiement.',
    not_found: 'Ce paiement est introuvable chez l’opérateur. Un agent va vérifier : nous avons ouvert une demande pour vous.',
    provider_unavailable: 'L’opérateur ne répond pas pour le moment. Un agent va vérifier : nous avons ouvert une demande pour vous.',
}[r]);

/**
 * Member "check my payment". The intent must belong to the member. A
 * not_found / unavailable answer opens an activation case and a ticket
 * (never an activation). `pending` schedules a re-check with backoff.
 */
/**
 * A payment the member never finished: no operator reference, and it is still
 * waiting for the member's details or no operator was ever chosen. Asking the
 * operator about it would only answer "not found", and most of these are
 * abandoned checkouts, so no case is opened unless the member says money left
 * the account.
 */
export function neverSubmitted(p: Pick<Payin, 'status' | 'gateway' | 'gatewayRef'>) {
    if (p.gatewayRef) return false;
    return p.status === 'PENDING_USER_INPUT' || !p.gateway || p.gateway === 'none';
}

export async function memberActivationCheck(userId: string, input: { sessionId?: unknown; reference?: unknown; moneyDebited?: unknown }, schedule: (sessionId: string, userId: string) => Promise<void>) {
    const ref = typeof input.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim()
        : typeof input.reference === 'string' && input.reference.trim() ? input.reference.trim() : '';
    if (!ref || ref.length > 120 || !/^[\w.:-]+$/.test(ref)) throw badRequest('Indiquez votre paiement ou la référence reçue.', 'BAD_REFERENCE');

    const payin = await lookupPayin(ref, userId);
    if (!payin) {
        const { ticketId, number } = await openActivationCaseAndTicket(userId, ref, { result: 'not_found', provider: 'unknown', checkedAt: new Date().toISOString() }, 'reference');
        return { result: 'not_found', message: memberMessage('not_found'), statusLabel: PAYIN_STATUS_LABELS.not_found, ticketId, ticketNumber: number };
    }
    if (neverSubmitted(payin)) {
        if (input.moneyDebited !== true) {
            return { result: 'not_finished', message: memberMessage('not_finished'), statusLabel: PAYIN_STATUS_LABELS.not_finished, ticketId: null, canReportDebit: true };
        }
        // The member says money left the account anyway: an agent checks with the operator.
        const { ticketId, number } = await openActivationCaseAndTicket(userId, payin.sessionId, { result: 'not_finished' as any, provider: payin.gateway || 'none', checkedAt: new Date().toISOString() }, 'session', payin.gateway);
        return { result: 'not_finished', message: 'Merci. Un agent va vérifier auprès de l’opérateur : nous avons ouvert une demande pour vous.', statusLabel: PAYIN_STATUS_LABELS.not_finished, ticketId, ticketNumber: number };
    }
    const result = await recheckPayin(payin.sessionId);
    if (result.result === 'not_found' || result.result === 'provider_unavailable') {
        const { ticketId, number } = await openActivationCaseAndTicket(userId, payin.sessionId, result, 'session', payin.gateway);
        return { result: result.result, message: memberMessage(result.result), statusLabel: PAYIN_STATUS_LABELS[result.result], ticketId, ticketNumber: number };
    }
    if (result.result === 'pending') await schedule(payin.sessionId, userId);
    return { result: result.result, message: memberMessage(result.result), statusLabel: PAYIN_STATUS_LABELS[result.result], ticketId: null };
}

/** One case per (member, payment); one open ticket per case. */
export async function openActivationCaseAndTicket(userId: string, ref: string, result: Partial<RecheckResult>, kind: 'session' | 'reference', gateway?: string) {
    const { caseId } = await upsertCase({
        type: 'activation', dedupKey: `activation:${userId}:${ref}`, severity: 'warning',
        summary: `Activation : ${(result.result as string) === 'not_finished' ? 'le membre dit avoir été débité pour un paiement jamais envoyé à un opérateur'
            : result.result === 'provider_unavailable' ? 'paiement non vérifiable (opérateur indisponible)' : 'paiement introuvable chez l’opérateur'}`,
        subject: { userId, sessionId: kind === 'session' ? ref : undefined, gateway }, details: { reference: kind === 'reference' ? ref : undefined },
    }, 'member-check');
    await recordCheck(caseId, `member:${userId}`, result);
    const c = await Case.findById(caseId).lean();
    if (c?.ticketId) {
        const t = await Ticket.findById(c.ticketId, { number: 1, status: 1 }).lean();
        if (t && t.status !== 'ferme') return { ticketId: String(c.ticketId), number: t.number };
    }
    const ticket = await createTicket({
        memberId: userId, category: 'activation_paiement', source: 'system',
        subject: 'Paiement à vérifier pour l’activation',
        body: `Vérification automatique du paiement ${ref} : ${PAYIN_STATUS_LABELS[result.result ?? 'not_found']}. Un agent va vérifier auprès de l’opérateur.`,
        caseId: new Types.ObjectId(caseId), author: { type: 'system', name: 'SBC Support' },
    });
    await Case.updateOne({ _id: caseId }, { $set: { ticketId: ticket._id } });
    return { ticketId: String(ticket._id), number: ticket.number };
}

/** Agent re-check of one payment of a member (activation.check). */
export async function deskRecheckPayin(userId: string, sessionId: string) {
    const payin = await lookupPayin(sessionId, userId);
    if (!payin) throw notFound('Paiement introuvable pour ce membre.');
    const result = await recheckPayin(payin.sessionId);
    return { payin, result };
}

// Manual activation, executed only after approval: payment-service verifies
// the external reference at the provider and refuses a reference already used.
registerExecutor('manual_activation', async (a) => {
    const p = a.payload as { userId: string; gateway: string; externalRef: string; plan: string };
    const r = await manualActivation({ userId: p.userId, gateway: p.gateway, externalRef: p.externalRef, plan: p.plan, approvalId: String(a._id) });
    if (r.ok) return { ok: true, result: r.data };
    const messages: Record<string, string> = {
        REF_ALREADY_USED: 'Cette référence de paiement a déjà servi à une activation.',
        PROVIDER_NOT_CONFIRMED: 'L’opérateur ne confirme pas ce paiement : activation refusée.',
    };
    return { ok: false, code: r.code ?? `HTTP_${r.status}`, message: (r.code && messages[r.code]) || r.message || 'Activation refusée par le service paiement.' };
});
