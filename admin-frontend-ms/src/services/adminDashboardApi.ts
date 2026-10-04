import apiClient from '../api/apiClient';

export interface RelanceStats {
    activeCampaigns: number;
    totalMessagesScheduled: number;
    totalMessagesSent: number;
    averageDeliveryRate: number;
    usersInRelance: number;
}

export interface RecentWithdrawal {
    _id: string;
    transactionId: string;
    userId: string;
    userName?: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    metadata?: any;
}

/**
 * Fetch relance statistics
 */
export async function getRelanceStats(): Promise<RelanceStats> {
    try {
        const response = await apiClient.get('/relance/campaigns/default/stats');

        // Extract stats from the response
        const data = response.data?.data;

        return {
            activeCampaigns: data?.activeCampaigns || 0,
            totalMessagesScheduled: data?.totalMessages || 0,
            totalMessagesSent: data?.sentMessages || 0,
            averageDeliveryRate: data?.deliveryRate || 0,
            usersInRelance: data?.totalUsersInRelance || 0
        };
    } catch (error: any) {
        console.error('Error fetching relance stats:', error);
        return {
            activeCampaigns: 0,
            totalMessagesScheduled: 0,
            totalMessagesSent: 0,
            averageDeliveryRate: 0,
            usersInRelance: 0
        };
    }
}

/**
 * Fetch recent withdrawals
 */
export async function getRecentWithdrawals(limit: number = 5): Promise<RecentWithdrawal[]> {
    try {
        const response = await apiClient.get('/payments/admin/withdrawals/pending', {
            params: {
                page: 1,
                limit
            }
        });

        return response.data?.data?.withdrawals || [];
    } catch (error: any) {
        console.error('Error fetching recent withdrawals:', error);
        return [];
    }
}

/**
 * Fetch USD balance from dashboard
 */
export async function getUSDBalance(): Promise<number> {
    try {
        const response = await apiClient.get('/users/admin/dashboard');
        return response.data?.data?.adminUSDBalance || 0;
    } catch (error: any) {
        console.error('Error fetching USD balance:', error);
        return 0;
    }
}
