import { useQueries, useQuery } from '@tanstack/react-query';
import apiClient from '../../api/apiClient';
import { getManualVerifications, getAdsCampaigns } from '../../api/adsNetwork';
import { listOrganizers, listAdminDisputes } from '../../api/event';
import { getStats as getSbcLoveStats } from '../../services/adminSbcLoveApi';
import { getWithdrawalStats, getStuckMoneyFusionWithdrawals, getStuckCinetPayWithdrawals } from '../../services/adminWithdrawalApi';
import { startOfTodayDouala, todayDouala } from '../../lib/format';

export type QueueKey = 'proofs' | 'withdrawals' | 'campaigns' | 'love' | 'organizers' | 'disputes' | 'stuck';

export type QueueDef = {
    key: QueueKey;
    title: string;
    /** where the list behind the count lives */
    to: string;
    roles: string[];
    load: () => Promise<{ count: number; detail?: string; oldest?: string }>;
};

const ADMIN = ['admin'];

/**
 * Everything that waits for an admin's decision, in the order it matters.
 * Each count is one cheap request; a failing one shows "—" without hiding
 * the others.
 */
export const QUEUES: QueueDef[] = [
    {
        key: 'proofs', title: 'Vérifications vidéo', to: '/a-traiter/verifications', roles: ['admin', 'moderator'],
        load: async () => {
            const items = await getManualVerifications();
            const oldest = items.map(i => i.uploadedAt || i.codeIssuedAt).filter(Boolean).sort()[0];
            return { count: items.length, oldest };
        },
    },
    {
        key: 'withdrawals', title: 'Retraits à valider', to: '/a-traiter/retraits', roles: ['admin', 'withdrawal_admin'],
        load: async () => ({ count: (await getWithdrawalStats()).data.pendingApproval }),
    },
    {
        key: 'campaigns', title: 'Campagnes pub à valider', to: '/modules/ads?onglet=campagnes&statut=a-valider', roles: ADMIN,
        load: async () => ({ count: (await getAdsCampaigns({ status: ['paid', 'pending_review'], limit: 1 })).pagination?.total ?? 0 }),
    },
    {
        key: 'love', title: 'Profils SBC Love', to: '/sbclove', roles: ADMIN,
        load: async () => ({ count: (await getSbcLoveStats()).profiles.pending }),
    },
    {
        key: 'organizers', title: 'Organisateurs à approuver', to: '/event/organizers', roles: ADMIN,
        load: async () => ({ count: (await listOrganizers({ status: 'PENDING', limit: 1 })).total }),
    },
    {
        key: 'disputes', title: 'Litiges billetterie', to: '/event/disputes', roles: ADMIN,
        load: async () => ({ count: (await listAdminDisputes({ status: 'OPEN', limit: 1 })).total }),
    },
    {
        key: 'stuck', title: 'Retraits bloqués chez le fournisseur', to: '/argent/bloques', roles: ['admin', 'withdrawal_admin'],
        load: async () => {
            const [mf, cp] = await Promise.all([getStuckMoneyFusionWithdrawals(1, 1), getStuckCinetPayWithdrawals(1, 1)]);
            const m = mf.data.pagination.total, c = cp.data.pagination.total;
            const parts = [m && `${m} MoneyFusion`, c && `${c} CinetPay`].filter(Boolean);
            return { count: m + c, detail: parts.join(' · ') || undefined };
        },
    },
];

export const queuesFor = (role: string | null) => QUEUES.filter(q => role && q.roles.includes(role));

/** Counts for the queues this role sees; refreshed every minute. */
export function useQueueCounts(role: string | null) {
    const defs = queuesFor(role);
    const results = useQueries({
        queries: defs.map(q => ({
            queryKey: ['queue', q.key],
            queryFn: q.load,
            refetchInterval: 60_000,
        })),
    });
    const total = results.reduce((s, r) => s + (r.data?.count ?? 0), 0);
    return { defs, results, total };
}

/**
 * Today's figures: one count request each, from Douala midnight. Withdrawal
 * admins get the withdrawal figures only — the rest is admin-only server-side.
 */
export function useToday(role: string | null) {
    const full = role === 'admin';
    return useQuery({
        queryKey: ['today', todayDouala(), full],
        enabled: full || role === 'withdrawal_admin',
        refetchInterval: 120_000,
        queryFn: async () => {
            const day = todayDouala();
            const count = (p: Promise<{ data: { pagination?: { total?: number; totalCount?: number } } }>) =>
                p.then(r => r.data.pagination?.totalCount ?? r.data.pagination?.total ?? null).catch(() => null);
            const none = Promise.resolve(null);
            const [signups, paid, failed, stats] = await Promise.all([
                full ? count(apiClient.get('/users/admin/users', { params: { createdFrom: startOfTodayDouala(), limit: 1 } })) : none,
                full ? count(apiClient.get('/payments/admin/transactions', { params: { status: 'SUCCEEDED', startDate: day, endDate: day, limit: 1 } })) : none,
                full ? count(apiClient.get('/payments/admin/transactions', { params: { status: 'FAILED', startDate: day, endDate: day, limit: 1 } })) : none,
                getWithdrawalStats().then(r => r.data).catch(() => null),
            ]);
            return { signups, paid, failed, withdrawalsApproved: stats?.approvedToday ?? null, withdrawalsRejected: stats?.rejectedToday ?? null };
        },
    });
}
