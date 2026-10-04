import apiClient from '../../api/apiClient';

export type Member = {
    _id: string;
    name: string;
    email?: string;
    phoneNumber?: string | number;
    country?: string;
    region?: string;
    city?: string;
    balance?: number;
    usdBalance?: number;
    activationBalance?: number;
    role?: string;
    blocked?: boolean;
    deleted?: boolean;
    isVerified?: boolean;
    avatar?: string;
    avatarId?: string;
    momoNumber?: string | number;
    momoOperator?: string;
    referralCode?: string;
    createdAt?: string;
    activeSubscriptionTypes?: string[];
    partnerPack?: 'silver' | 'gold';
    referrer?: { _id: string; name: string; phoneNumber?: string; email?: string; avatar?: string };
};

export type MemberFilters = {
    search?: string;
    status?: '' | 'active' | 'blocked' | 'deleted';
    subscription?: '' | 'classique' | 'cible' | 'any' | 'none';
    partner?: '' | 'silver' | 'gold' | 'any';
    role?: string;
    country?: string;
    createdFrom?: string;
};

export type Paged<T> = { items: T[]; total: number; totalPages: number; page: number };

export async function listMembers(f: MemberFilters, page: number, limit = 20): Promise<Paged<Member>> {
    const params: Record<string, string | number> = { page, limit };
    Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v as string; });
    const { data } = await apiClient.get('/users/admin/users', { params });
    const p = data.pagination ?? {};
    return { items: data.data ?? [], total: p.totalCount ?? 0, totalPages: p.totalPages ?? 1, page: p.currentPage ?? page };
}

export async function getMember(id: string): Promise<Member> {
    const { data } = await apiClient.get(`/users/admin/users/${id}`);
    return data.data;
}

export type Referral = {
    _id: string; name: string; email?: string; phoneNumber?: string; referralLevel: number; createdAt: string;
    activeSubscriptions?: string[]; activeSubscriptionTypes?: string[];
};

export async function listReferrals(id: string, level: number, page: number, search?: string): Promise<Paged<Referral>> {
    const { data } = await apiClient.get(`/users/admin/users/${id}/referrals`, { params: { level, page, limit: 20, ...(search ? { search } : {}) } });
    const p = data.pagination ?? {};
    return { items: data.data ?? [], total: p.totalCount ?? 0, totalPages: p.totalPages ?? 1, page: p.currentPage ?? page };
}

export const updateMember = (id: string, body: Partial<Member>) => apiClient.put(`/users/admin/users/${id}`, body);
export const setBlocked = (id: string, blocked: boolean) => apiClient.patch(`/users/admin/users/${id}/${blocked ? 'block' : 'unblock'}`);
export const deleteMember = (id: string) => apiClient.delete(`/users/admin/users/${id}`);
export const restoreMember = (id: string) => apiClient.patch(`/users/admin/users/${id}/restore`);
export const setSubscription = (id: string, type: 'CLASSIQUE' | 'CIBLE' | 'NONE') => apiClient.patch(`/users/admin/users/${id}/subscription`, { type });
export const setRole = (id: string, role: string) => apiClient.patch(`/users/admin/users/${id}/role`, { role });
export const setPartnerPack = (id: string, pack: 'silver' | 'gold' | 'none') =>
    pack === 'none'
        ? apiClient.patch(`/users/admin/partners/${id}/deactivate`)
        : apiClient.post('/users/admin/partners/set-user-partner', { userId: id, pack });
