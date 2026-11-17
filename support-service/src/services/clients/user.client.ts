import { serviceRequest, requireOk, isRouteMissing } from './http';
import { DependencyError } from '../../utils/errors';

/** user-service internal API (CONTRACT §2.1). */

export interface SupportMember {
    _id: string; name: string; email?: string; phoneNumber?: string; country?: string; city?: string; sex?: string;
    language?: string; role?: string; createdAt?: string; lastLogin?: string; isVerified?: boolean; blocked?: boolean;
    deleted?: boolean; referrerId?: string; referrerName?: string; balance?: number; usdBalance?: number;
    reservedBalance?: number; debt?: number; withdrawalLockedUntil?: string | null;
    subscriptions?: { type: string; category?: string; status: string; startDate?: string; endDate?: string | null }[];
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

export type ContactChangeStep = 'send-code' | 'apply';

export interface ContactChangeResult { ok: boolean; code?: string; message?: string }

export async function contactChange(body: {
    userId: string; field: 'email' | 'phoneNumber'; newValue: string; step: ContactChangeStep; code?: string; approvalId: string;
}): Promise<ContactChangeResult> {
    const r = await serviceRequest('user', 'POST', `${BASE}/support/contact-change`, { body });
    if (r.ok) return { ok: true };
    if (isRouteMissing(r)) throw new DependencyError('user', 404);
    return { ok: false, code: r.code, message: r.message };
}
