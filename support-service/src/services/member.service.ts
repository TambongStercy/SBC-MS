import { Types } from 'mongoose';
import { hasPermission } from '../config/permissions';
import { withdrawalStatusText } from '../config/constants';
import { Approval } from '../database/models/approval.model';
import { Ticket } from '../database/models/ticket.model';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { maskEmail, maskPhone } from '../utils/mask';
import { contactChange, getSupportMember, searchMembers, SupportMember } from './clients/user.client';
import { memberPayins, memberWithdrawals } from './clients/payment.client';
import { AgentRef } from '../database/models/approval.model';
import { createApproval } from './approval.service';
import { audit } from './audit.service';

/** Masking per permission (CONTRACT §4). Balances only for finance or full readers. */
export function presentMember(m: SupportMember, roles: string[]) {
    const full = hasPermission(roles, 'members.read.full');
    const money = full || hasPermission(roles, 'finance.read');
    return {
        _id: String(m._id), id: String(m._id), name: m.name, country: m.country ?? null, city: m.city ?? null, sex: m.sex ?? null, language: m.language ?? null,
        role: m.role ?? null, createdAt: m.createdAt ?? null,
        // user-service fills `lastLogin` from ipLastUpdated: it is the last activity, not a sign-in.
        lastLogin: m.lastLogin ?? null, lastActivityAt: m.lastLogin ?? null, isVerified: m.isVerified ?? null,
        blocked: m.blocked ?? false, deleted: m.deleted ?? false, referrerId: m.referrerId ?? null, referrerName: m.referrerName ?? null,
        email: full ? m.email ?? null : maskEmail(m.email), phoneNumber: full ? m.phoneNumber ?? null : maskPhone(m.phoneNumber),
        masked: !full,
        withdrawalLockedUntil: m.withdrawalLockedUntil ?? null,
        subscriptions: m.subscriptions ?? [],
        ...(money ? { balance: m.balance ?? null, usdBalance: m.usdBalance ?? null, reservedBalance: m.reservedBalance ?? null, debt: m.debt ?? null } : {}),
    };
}

export async function search(q: unknown) {
    const text = typeof q === 'string' ? q.trim().slice(0, 100) : '';
    if (text.length < 2) throw badRequest('Saisissez au moins 2 caractères.', 'BAD_QUERY');
    return searchMembers(text, 20);
}

/** The member profile (masked per permission). Payins, withdrawals and tickets have their own routes. */
export async function profile(userId: string, roles: string[]) {
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw notFound('Membre introuvable.');
    const m = await getSupportMember(userId);
    if (!m) throw notFound('Membre introuvable.');
    return presentMember(m, roles);
}

export const withdrawalsWithText = async (userId: string, limit: number) =>
    (await memberWithdrawals(userId, limit)).map((w) => {
        const t = withdrawalStatusText(w.businessStatus);
        return { ...w, statusLabel: t.label, explanation: t.explanation };
    });

export const payins = (userId: string, limit: number) => memberPayins(userId, limit);

export const memberTickets = (userId: string) => Ticket.find({ memberId: userId }).sort({ createdAt: -1 }).limit(50).lean();

// ---------- Contact change for a member without account access ----------

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export async function requestContactChange(userId: string, input: { field?: unknown; newValue?: unknown; reason?: unknown; ticketId?: unknown; evidence?: unknown }, by: AgentRef, ctx: { ip?: string; userAgent?: string }) {
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw notFound('Membre introuvable.');
    const field = input.field === 'email' ? 'email' : input.field === 'phoneNumber' ? 'phoneNumber' : null;
    if (!field) throw badRequest('Champ inconnu (email ou phoneNumber).', 'BAD_FIELD');
    const raw = typeof input.newValue === 'string' ? input.newValue.trim() : '';
    const newValue = field === 'email' ? raw.toLowerCase() : raw.replace(/[^\d+]/g, '');
    if (field === 'email' ? !EMAIL_RE.test(newValue) : !/^\+?\d{8,15}$/.test(newValue)) throw badRequest('Nouvelle valeur invalide.', 'BAD_VALUE');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 2000) : '';
    // The identity-check procedure is still to be fixed by SBC (CdC §15.1): the
    // reason must describe it; evidence references are optional for now.
    if (reason.length < 20) throw badRequest('Décrivez la vérification d’identité effectuée (20 caractères au moins).', 'REASON_REQUIRED');
    const evidence = Array.isArray(input.evidence) ? input.evidence.filter((e) => typeof e === 'string').slice(0, 10).map((e) => (e as string).slice(0, 300)) : [];
    const member = await getSupportMember(userId);
    if (!member) throw notFound('Membre introuvable.');
    const open = await Approval.exists({ type: 'contact_change', 'subject.userId': userId, status: { $in: ['pending', 'approved'] } });
    if (open) throw conflict('Une demande de changement est déjà en cours pour ce membre.', 'ALREADY_PENDING');
    return createApproval({
        type: 'contact_change', requestedBy: by, reason, payload: { field, newValue, evidence, codeSentAt: null },
        subject: { userId }, ticketId: typeof input.ticketId === 'string' ? input.ticketId : null,
    }, ctx);
}

async function approvedContactChange(approvalId: string) {
    if (!Types.ObjectId.isValid(approvalId)) throw notFound('Demande introuvable.');
    const a = await Approval.findById(approvalId).lean();
    if (!a || a.type !== 'contact_change') throw notFound('Demande introuvable.');
    if (a.status !== 'approved') throw conflict('Cette demande doit d’abord être validée par un responsable.', 'NOT_APPROVED');
    return a;
}

const involved = (a: { requestedBy: AgentRef; approvals: { agent: AgentRef }[] }, agent: AgentRef, roles: string[]) =>
    a.requestedBy.id === agent.id || a.approvals.some((x) => x.agent.id === agent.id) || hasPermission(roles, 'members.contact.approve');

const NEUTRAL_UNAVAILABLE = 'Cette adresse ou ce numéro ne peut pas être utilisé. Demandez-en un autre au membre.';

/**
 * user-service refusals, in French. None of them consumes the approval: it
 * stays `approved` and the step can be tried again later (CHANNEL_UNAVAILABLE:
 * phone changes are off while WhatsApp OTP is off — never retried automatically).
 */
const CONTACT_ERRORS: Record<string, { status: number; message: string }> = {
    CONTACT_UNAVAILABLE: { status: 400, message: NEUTRAL_UNAVAILABLE },
    CHANNEL_UNAVAILABLE: { status: 503, message: 'Changement de téléphone indisponible pour le moment. La demande validée reste utilisable plus tard.' },
    INVALID_CODE: { status: 400, message: 'Code incorrect ou expiré. Demandez au membre le dernier code reçu, ou renvoyez-en un.' },
    SAME_VALUE: { status: 400, message: 'La nouvelle valeur est identique à celle du compte.' },
    CODE_COOLDOWN: { status: 429, message: 'Un code vient d’être envoyé. Patientez avant d’en demander un autre.' },
    STATE_CHANGED: { status: 409, message: 'Le compte du membre a changé entre-temps. Vérifiez sa fiche avant de continuer.' },
};

function contactError(code: string | undefined, fallback: string, fallbackCode: string): AppError {
    const e = code ? CONTACT_ERRORS[code] : undefined;
    return e ? new AppError(e.status, e.message, code) : new AppError(400, fallback, code || fallbackCode);
}

/** Sends the confirmation code to the NEW contact (user-service). */
export async function sendContactCode(approvalId: string, agent: AgentRef, roles: string[], ctx: { ip?: string; userAgent?: string }) {
    const a = await approvedContactChange(approvalId);
    if (!involved(a, agent, roles)) throw forbidden();
    const p = a.payload as { field: 'email' | 'phoneNumber'; newValue: string };
    const r = await contactChange({ userId: a.subject.userId!, field: p.field, newValue: p.newValue, step: 'send-code', approvalId });
    await audit({ actor: { type: 'agent', ...agent }, action: 'member.contact_change.code_sent', result: r.ok ? 'ok' : 'error', target: { type: 'member', id: a.subject.userId }, meta: { approvalId, field: p.field, upstreamCode: r.code ?? null }, ...ctx });
    if (!r.ok) throw contactError(r.code, r.message || 'Envoi du code refusé.', 'SEND_FAILED');
    await Approval.updateOne({ _id: a._id }, { $set: { 'payload.codeSentAt': new Date() } });
    return { ok: true };
}

/** Applies the change with the code the member received on the new contact. */
export async function applyContactChange(approvalId: string, code: unknown, agent: AgentRef, roles: string[], ctx: { ip?: string; userAgent?: string }) {
    const a = await approvedContactChange(approvalId);
    if (!involved(a, agent, roles)) throw forbidden();
    if (typeof code !== 'string' || !/^[A-Za-z0-9]{4,10}$/.test(code.trim())) throw badRequest('Code invalide.', 'BAD_CODE');
    const p = a.payload as { field: 'email' | 'phoneNumber'; newValue: string };
    const r = await contactChange({ userId: a.subject.userId!, field: p.field, newValue: p.newValue, step: 'apply', code: code.trim(), approvalId });
    if (!r.ok) {
        await audit({ actor: { type: 'agent', ...agent }, action: 'member.contact_change.apply_refused', result: 'denied', target: { type: 'member', id: a.subject.userId }, meta: { approvalId, upstreamCode: r.code ?? null }, ...ctx });
        throw contactError(r.code, r.message || 'Code refusé.', 'APPLY_FAILED');
    }
    const u = await Approval.updateOne({ _id: a._id, status: 'approved' }, { $set: { status: 'executed', execution: { at: new Date(), by: agent, ok: true } } });
    await audit({
        actor: { type: 'agent', ...agent }, action: 'member.contact_change.applied', target: { type: 'member', id: a.subject.userId },
        after: { field: p.field, value: p.field === 'email' ? maskEmail(p.newValue) : maskPhone(p.newValue) }, meta: { approvalId, recorded: u.modifiedCount === 1 }, reason: a.reason, ...ctx,
    });
    return { ok: true };
}
