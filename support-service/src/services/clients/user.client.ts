import { serviceRequest, requireOk, isRouteMissing } from './http';
import { DependencyError } from '../../utils/errors';

/** user-service internal API (CONTRACT §2.1). */

export interface SupportMember {
    _id: string; name: string; email?: string; phoneNumber?: string; country?: string; city?: string; sex?: string;
    language?: string; role?: string; createdAt?: string; lastLogin?: string; isVerified?: boolean; blocked?: boolean;
    deleted?: boolean; referrerId?: string; referrerName?: string; balance?: number; usdBalance?: number;
    reservedBalance?: number; debt?: number; withdrawalLockedUntil?: string | null;
    subscriptions?: { type: string; category?: string; status: string; startDate?: string; endDate?: string | null }[];
    /** Phase 5: declared / usual / last country (Phase 1 signals). */
    geo?: { declared: string | null; usual: string | null; usualShare: number | null; last: string | null; lastAt: string | null } | null;
    /** Phase 5: balance A (account) against B (opening + movements), per currency; null before the opening snapshot. */
    ledger?: { currency: 'XAF' | 'USD'; actual: number; expected: number; matches: boolean }[] | null;
    /** Phase 5: money frozen by support (withdrawals and transfers suspended). */
    frozen?: { at: string; reason: string | null } | null;
    momoNumber?: string | null;
    momoOperator?: string | null;
    /** Account suspended (user-service account-ban.service, 2026-11-23). */
    ban?: { at: string; reason: string; by?: string | null; details?: Record<string, any> | null } | null;
    banHistory?: { at: string | null; reason: string | null; liftedAt: string | null; liftedBy: string | null; liftReason: string | null }[];
}

export interface MemberSearchHit { _id: string; name: string; country?: string; role?: string; createdAt?: string }

const BASE = '/api/users/internal';

export async function getSupportDetails(userIds: string[]): Promise<SupportMember[]> {
    if (!userIds.length) return [];
    const r = await serviceRequest<SupportMember[]>('user', 'POST', `${BASE}/support-details`, { body: { userIds: userIds.slice(0, 100) } });
    return requireOk('user', r) ?? [];
}

export async function getSupportMember(userId: string): Promise<SupportMember | null> {
    const list = await getSupportDetails([userId]);
    return list.find((m) => String(m._id) === String(userId)) ?? null;
}

export async function searchMembers(q: string, limit = 20): Promise<MemberSearchHit[]> {
    const r = await serviceRequest<MemberSearchHit[]>('user', 'POST', `${BASE}/support-search`, { body: { q, limit: Math.min(limit, 20) } });
    return requireOk('user', r) ?? [];
}

/** Security plan Phase 11: the day's activity figures (user-service computes them once for admin and support). */
export async function getActivityBoard(q: { range?: string; source?: string; countries?: string[] }): Promise<unknown> {
    const r = await serviceRequest('user', 'GET', `${BASE}/activity/board`, {
        query: { range: q.range, source: q.source, countries: q.countries?.length ? q.countries.join(',') : undefined },
    });
    return requireOk('user', r);
}

export type ContactChangeStep = 'send-code' | 'apply';

export interface ContactChangeResult { ok: boolean; code?: string; message?: string }

export async function contactChange(body: {
    userId: string; field: 'email' | 'phoneNumber'; newValue: string; step: ContactChangeStep; code?: string; approvalId: string;
}): Promise<ContactChangeResult> {
    const r = await serviceRequest('user', 'POST', `${BASE}/support/contact-change`, { body, businessCodes5xx: ['CHANNEL_UNAVAILABLE'] });
    if (r.ok) return { ok: true };
    if (isRouteMissing(r)) throw new DependencyError('user', 404);
    return { ok: false, code: r.code, message: r.message };
}

// ---- Security plan Phase 5 ----

/** Whether two members are the same account or in each other's referral tree (3 levels up or down). Throws when user-service is down (callers fail closed). */
export async function areRelated(userId: string, otherUserId: string): Promise<boolean> {
    const r = await serviceRequest<{ related: boolean }>('user', 'POST', `${BASE}/support/related`, { body: { userId, otherUserId } });
    if (isRouteMissing(r)) throw new DependencyError('user', 404);
    const data = requireOk('user', r);
    return !!data?.related;
}

export interface OwnerActionResult { ok: boolean; code?: string; message?: string; data?: any }

async function ownerAction(path: string, body: Record<string, unknown>): Promise<OwnerActionResult> {
    const r = await serviceRequest('user', 'POST', `${BASE}${path}`, { body });
    if (r.ok) return { ok: true, data: r.data };
    if (isRouteMissing(r)) throw new DependencyError('user', 404);
    return { ok: false, code: r.code, message: r.message };
}

/** Removes the member's authenticator app (lost phone), locks withdrawals 72 h and e-mails the member. */
export const resetMemberAuthenticator = (body: { userId: string; reason: string; approvalId: string }) =>
    ownerAction('/support/authenticator-reset', body);

/** Freezes (withdrawals and transfers suspended until unfrozen) or unfreezes the member's money. */
export const freezeMember = (body: { userId: string; action: 'freeze' | 'unfreeze'; reason: string; approvalId: string }) =>
    ownerAction('/support/freeze', body);

/** Lifts the member's suspension (`409 NOT_BANNED` when there is none). `by` is the desk actor. */
export async function unbanMember(userId: string, body: { by: string; reason: string }): Promise<OwnerActionResult> {
    return ownerAction(`/${userId}/unban`, body);
}

/** Replaces the member's Mobile Money number and operator (locks withdrawals, alerts the account e-mail). */
export const changeMemberMomo = (body: { userId: string; momoNumber: string; momoOperator: string; approvalId: string }) =>
    ownerAction('/support/momo-change', body);
