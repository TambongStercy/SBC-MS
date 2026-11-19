import apiClient from '../../api/apiClient';
import type {
  AdsAnalytics, AdsCampaign, AdsMediaChange, CampaignStatus, LeaderboardEntry, ManualVerification,
} from '../../api/adsNetwork';

/**
 * The Ads Network list/stat reads with the admin country + period filters
 * (`country`, `from`, `to`, see usePageFilters). The functions in
 * src/api/adsNetwork.ts don't forward them; the writes (approve, reject…)
 * are still called from there.
 *
 * advertising-service semantics (admin.controller): campaigns and media
 * changes filter on the ANNONCEUR's country, diffuseurs and video proofs on
 * the DIFFUSEUR's; dates on createdAt / pendingMedia.submittedAt / uploadedAt.
 */
export interface AdminFilterParams { country?: string; from?: string; to?: string }

export const fetchAdsAnalytics = async (months: number, f: AdminFilterParams): Promise<AdsAnalytics> => {
  const { data } = await apiClient.get('/advertising/admin/analytics', { params: { months, ...f } });
  return data.data;
};

export const fetchAdsCampaigns = async (params: { page?: number; limit?: number; status?: CampaignStatus | CampaignStatus[] }, f: AdminFilterParams) => {
  const { data } = await apiClient.get('/advertising/admin/campaigns', {
    params: {
      page: params.page,
      limit: params.limit,
      status: Array.isArray(params.status) ? params.status.join(',') : params.status,
      ...f,
    },
  });
  return {
    campaigns: data.data as AdsCampaign[],
    pagination: data.pagination as { page: number; limit: number; total: number; pages: number },
  };
};

export const fetchMediaChanges = async (f: AdminFilterParams): Promise<AdsMediaChange[]> => {
  const { data } = await apiClient.get('/advertising/admin/media-changes', { params: f });
  return data.data ?? [];
};

export const fetchLeaderboard = async (params: { page?: number; limit?: number; sortBy?: 'views' | 'clicks' | 'trust'; measuredOnly?: boolean }, f: AdminFilterParams) => {
  const { data } = await apiClient.get('/advertising/admin/diffuseurs', { params: { ...params, ...f } });
  return { entries: data.data as LeaderboardEntry[], total: data.pagination?.total as number };
};

export const fetchManualVerifications = async (f: AdminFilterParams): Promise<ManualVerification[]> => {
  const { data } = await apiClient.get('/advertising/admin/manual-verifications', { params: f });
  return data.data;
};

/**
 * One page of the video-proof queue. `adminDecisions.readOnly`: proofs are
 * decided in SBC Support; `allowed` is true only for the super admin then.
 */
export interface ManualVerificationPage {
  items: ManualVerification[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  adminDecisions: { readOnly: boolean; allowed: boolean };
}

export const fetchManualVerificationPage = async (params: { page: number; limit: number }, f: AdminFilterParams): Promise<ManualVerificationPage> => {
  const { data } = await apiClient.get('/advertising/admin/manual-verifications', { params: { ...params, ...f } });
  const items = (data.data ?? []) as ManualVerification[];
  return {
    items,
    pagination: data.pagination ?? { page: params.page, limit: params.limit, total: items.length, totalPages: 1 },
    // An older service without the flag behaves as before (decisions open).
    adminDecisions: data.adminDecisions ?? { readOnly: false, allowed: true },
  };
};

/** Country only (queues show everything pending whatever the period). */
export const countryOnly = (f: AdminFilterParams): AdminFilterParams => (f.country ? { country: f.country } : {});
