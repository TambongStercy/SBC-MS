import apiClient from '../../api/apiClient';
import type { ChallengeAnalytics, ChallengeListResult, ChallengeStatus, ChallengeVote } from '../../services/impactChallengeApi';

/**
 * Impact Challenge reads with the admin country + period filters (see
 * usePageFilters). The functions in services/impactChallengeApi.ts don't
 * forward them; every write is still called from there.
 *
 * tombola-service semantics (impact-challenge.controller):
 * - list: from/to on the challenge's startDate; country = has an entrepreneur from it.
 * - analytics, votes: country = the voter's; from/to on the vote's date.
 */
export interface AdminFilterParams { country?: string; from?: string; to?: string }

const unwrap = <T>(res: { data: { success?: boolean; data?: T; message?: string } }, fallback: string): T => {
    if (!res.data?.success || res.data.data === undefined) throw new Error(res.data?.message || fallback);
    return res.data.data;
};

export const fetchChallenges = async (page: number, limit: number, status: ChallengeStatus | undefined, f: AdminFilterParams): Promise<ChallengeListResult> =>
    unwrap(await apiClient.get('/challenges/admin', { params: { page, limit, ...(status ? { status } : {}), ...f } }), 'Impossible de charger les challenges.');

export const fetchAnalytics = async (challengeId: string, f: AdminFilterParams): Promise<ChallengeAnalytics> =>
    unwrap(await apiClient.get(`/challenges/admin/${challengeId}/analytics`, { params: f }), 'Impossible de charger le classement.');

export const fetchVotes = async (challengeId: string, page: number, limit: number, f: AdminFilterParams): Promise<{ votes: ChallengeVote[]; total: number }> =>
    unwrap(await apiClient.get(`/challenges/admin/${challengeId}/votes`, { params: { page, limit, ...f } }), 'Impossible de charger les votes.');

/** Country only (queues show everything pending whatever the period). */
export const countryOnly = (f: AdminFilterParams): AdminFilterParams => (f.country ? { country: f.country } : {});
