import axios from 'axios';
import apiClient from './apiClient';

/**
 * SBC Ads Network — admin API.
 *
 * Talks to advertising-service through the gateway at /api/advertising. All of
 * these require an admin role; the service rejects anything else with a 403.
 */

export type CampaignStatus =
    | 'draft'
    | 'pending_review'
    | 'approved'
    | 'rejected'
    | 'active'
    | 'completed'
    | 'banked'
    | 'cancelled';

export interface CampaignTargeting {
    countries?: string[];
    cities?: string[];
    regions?: string[];
    sex?: string[];
    minAge?: number;
    maxAge?: number;
    interests?: string[];
    professions?: string[];
    languages?: string[];
}

export interface AdsCampaign {
    _id: string;
    advertiserUserId: string;
    title: string;
    description?: string;
    mediaFileId: string;
    mediaType: 'image' | 'video';
    suggestedCaption?: string;
    landingPageSlug: string;
    landingPageUrl?: string;
    contactWhatsapp?: string;
    contactPhone?: string;
    websiteUrl?: string;
    targeting: CampaignTargeting;
    amountPaid: number;
    pricePerUniqueView: number;
    targetUniqueViews: number;
    uniqueViewsDelivered: number;
    repeatViewsDelivered: number;
    clicksTotal: number;
    status: CampaignStatus;
    submittedForReviewAt?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    rejectionReason?: string;
    activatedAt?: string;
    completedAt?: string;
    createdAt: string;
    progress: {
        uniqueViewsDelivered: number;
        targetUniqueViews: number;
        repeatViewsDelivered: number;
        totalViewsDelivered: number;
        clicksTotal: number;
        percentComplete: number;
    };
    /** Resolved from user-service; null when that lookup failed. */
    advertiser: {
        _id: string;
        name?: string;
        email?: string;
        phoneNumber?: string;
        country?: string;
    } | null;
    priorApprovedCampaigns: number;
    isFirstCampaign: boolean;
}

export interface AdsAnalytics {
    annonceurs: { total: number; newThisMonth: number };
    diffuseurs: { total: number; newThisMonth: number };
    campaigns: {
        total: number;
        launchedThisMonth: number;
        completedThisMonth: number;
        pendingReview: number;
        byStatus: Record<string, number>;
    };
    delivery: { uniqueViews: number; repeatViews: number; totalViews: number; clicks: number };
    money: {
        revenue: number;
        revenueThisMonth: number;
        paidToDiffuseurs: number;
        grossMargin: number;
        participationsPaid: number;
    };
    pipeline: { inProgress: number; offered: number };
    series: Array<{
        month: string;
        campaignsLaunched: number;
        revenue: number;
        views: number;
        clicks: number;
        newDiffuseurs: number;
        paidToDiffuseurs: number;
    }>;
}

export interface DiffuseurPerformance {
    diffuseurUserId: string;
    name: string | null;
    phoneNumber: string | null;
    status: string;
    acceptedAt?: string;
    uniqueViews: number;
    repeatViews: number;
    totalViews: number;
    clicks: number;
    clicksByAction: Record<string, number>;
    earned: number;
    paidAt: string | null;
    clickThroughRate: number;
}

export interface LeaderboardEntry {
    userId: string;
    name: string | null;
    phoneNumber: string | null;
    country: string | null;
    averageViews: number;
    /** False while the diffuseur is still on their self-declared number. */
    isMeasured: boolean;
    clickThroughRate: number;
    trustScore: number;
    campaignsCompleted: number;
    totalVerifiedViews: number;
    totalClicks: number;
}

export const getAdsAnalytics = async (months = 12): Promise<AdsAnalytics> => {
    const { data } = await apiClient.get('/advertising/admin/analytics', { params: { months } });
    return data.data;
};

/** Omit `status` for the moderation queue; it defaults to pending_review. */
export const getAdsCampaigns = async (params: {
    page?: number;
    limit?: number;
    status?: CampaignStatus | CampaignStatus[];
} = {}) => {
    const { data } = await apiClient.get('/advertising/admin/campaigns', {
        params: {
            page: params.page,
            limit: params.limit,
            status: Array.isArray(params.status) ? params.status.join(',') : params.status,
        },
    });
    return {
        campaigns: data.data as AdsCampaign[],
        pagination: data.pagination as { page: number; limit: number; total: number; pages: number },
    };
};

export const getAdsCampaignPerformance = async (campaignId: string) => {
    const { data } = await apiClient.get(`/advertising/admin/campaigns/${campaignId}/performance`);
    return data.data as { campaign: AdsCampaign; diffuseurs: DiffuseurPerformance[] };
};

export const approveAdsCampaign = async (campaignId: string) => {
    const { data } = await apiClient.post(`/advertising/admin/campaigns/${campaignId}/approve`);
    return data.data;
};

/** The reason is mandatory server-side — the annonceur cannot fix anything without it. */
export const rejectAdsCampaign = async (campaignId: string, reason: string) => {
    const { data } = await apiClient.post(`/advertising/admin/campaigns/${campaignId}/reject`, { reason });
    return data.data;
};

export const getDiffuseurLeaderboard = async (params: {
    page?: number;
    limit?: number;
    sortBy?: 'views' | 'clicks' | 'trust';
    measuredOnly?: boolean;
} = {}) => {
    const { data } = await apiClient.get('/advertising/admin/diffuseurs', { params });
    return {
        entries: data.data as LeaderboardEntry[],
        total: data.pagination?.total as number,
    };
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
    draft: 'Brouillon',
    pending_review: 'À valider',
    approved: 'Validée',
    rejected: 'Refusée',
    active: 'Active',
    completed: 'Terminée',
    banked: 'Créditée',
    cancelled: 'Annulée',
};

/**
 * The service answers in French and its message is what should reach the admin —
 * "Un motif de refus est obligatoire" is useful, "Request failed with status 400"
 * is not.
 */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err)) return err.response?.data?.message || err.message || fallback;
    return err instanceof Error ? err.message : fallback;
};

export const formatXaf = (amount: number) =>
    `${Math.round(amount).toLocaleString('fr-FR')} FCFA`;
