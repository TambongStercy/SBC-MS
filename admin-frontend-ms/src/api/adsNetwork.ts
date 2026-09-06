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
    | 'paid'
    | 'rejected'
    | 'active'
    | 'paused'
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
    /** Signed, so it opens even before the campaign is live. */
    previewUrl?: string;
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
        avatar?: string;
    } | null;
    priorApprovedCampaigns: number;
    isFirstCampaign: boolean;
    /**
     * What the current diffuseur pool could actually deliver for this targeting.
     * null when the estimate could not be made — show "inconnu", never a zero,
     * which would read as "nobody matches".
     */
    reach: {
        eligible: number;
        matching: number;
        projectedUniqueViews: number;
        targetUniqueViews?: number;
        sufficient?: boolean;
    } | null;
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

export interface TestCampaign {
    _id: string;
    title: string;
    description?: string;
    mediaFileId: string;
    mediaType: 'image' | 'video';
    suggestedCaption?: string;
    landingVideoFileId?: string;
    contactWhatsapp?: string;
    contactPhone?: string;
    websiteUrl?: string;
    landingPageUrl?: string;
    /** Signed, so it opens even before the campaign is live. */
    previewUrl?: string;
    stats?: { offered: number; inProgress: number; measured: number };
}

/** Answers `null` when no test campaign is configured — an empty editor, not an error. */
export const getTestCampaign = async (): Promise<TestCampaign | null> => {
    const { data } = await apiClient.get('/advertising/admin/test-campaign');
    return data.data ?? null;
};

export const saveTestCampaign = async (body: Partial<TestCampaign> & { force?: boolean }): Promise<TestCampaign> => {
    const { data } = await apiClient.put('/advertising/admin/test-campaign', body);
    return data.data;
};

export const retireTestCampaign = async () => {
    const { data } = await apiClient.delete('/advertising/admin/test-campaign');
    return data.data as { retired: boolean };
};

/** Generic upload; returns the fileId the campaign stores. */
export const uploadAdsFile = async (
    file: File,
    onProgress?: (percent: number) => void,
): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/settings/files/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A 70MB video on mobile data runs for minutes; without a timeout of
        // its own axios would inherit any global one, and without progress the
        // admin has no way to tell it apart from a hang.
        timeout: 15 * 60 * 1000,
        onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
    });
    const fileId = data?.data?.fileId;
    if (!fileId) throw new Error("Le fichier n'a pas pu être envoyé.");
    return fileId;
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
    paid: 'Payée — à valider',
    rejected: 'Refusée',
    active: 'Active',
    paused: 'En pause',
    completed: 'Terminée',
    banked: 'Clôturée — crédit rendu',
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

// --- Manual (video-proof) verification ---

export interface ManualVerification {
    manualVerificationId: string;
    participationId: string;
    day: number;
    code: string;
    codeIssuedAt: string;
    uploadedAt?: string;
    videoFileId: string | null;
    videoUrl: string | null;
    diffuseurName: string;
    diffuseurPhone?: string;
    campaignTitle: string;
    isTestCampaign: boolean;
}

export const getManualVerifications = async (): Promise<ManualVerification[]> => {
    const { data } = await apiClient.get('/advertising/admin/manual-verifications');
    return data.data;
};

export const approveManualVerification = async (id: string, observedViewCount: number) => {
    const { data } = await apiClient.post(`/advertising/admin/manual-verifications/${id}/approve`, { observedViewCount });
    return data;
};

/**
 * Refuse a recording, optionally banning the diffuseur in the same action.
 *
 * The refusal reason doubles as the ban reason — it is the same judgement about
 * the same recording, and asking twice only gets it typed shorter the second time.
 */
export const rejectManualVerification = async (id: string, reason: string, ban = false) => {
    const { data } = await apiClient.post(`/advertising/admin/manual-verifications/${id}/reject`, { reason, ban });
    return data;
};
