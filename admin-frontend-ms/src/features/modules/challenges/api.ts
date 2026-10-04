import apiClient from '../../../api/apiClient';
import type { Tone } from '../../../ui';

/**
 * Impact Challenge (tombola-service, `/api/challenges/admin`). Each month up to
 * three entrepreneurs pitch in a video; members pay to vote, the public pays to
 * support. Every vote also gives tombola tickets for the same month. When voting
 * closes the most-voted entrepreneur wins; the money collected is split 50 %
 * winner, 30 % tombola pool, 20 % SBC.
 */

export type ChallengeStatus = 'draft' | 'active' | 'voting_closed' | 'funds_distributed' | 'cancelled';
export interface Challenge {
    _id: string;
    campaignName: string;
    month: number;
    year: number;
    status: ChallengeStatus;
    startDate: string;
    endDate: string;
    description?: { fr?: string; en?: string } | string;
    tombolaMonthId: string;
    totalCollected: number;
    totalVoteCount: number;
    fundsDistributed: boolean;
    distributionDate?: string;
    winnerPayoutAmount?: number;
    lotteryPoolAmount?: number;
    commissionAmount?: number;
    createdAt: string;
}
export interface Entrepreneur {
    _id: string;
    challengeId: string;
    userId?: string;
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    city: string;
    projectName: string;
    projectDescription: { fr: string; en: string };
    businessCategory: string;
    videoUrl: string;
    videoFilename: string;
    videoDuration?: number;
    voteCount: number;
    totalAmount: number;
    rank?: number;
    isWinner: boolean;
    approved: boolean;
}
export interface Vote {
    _id: string;
    entrepreneurId: string;
    userId?: string;
    amountPaid: number;
    voteQuantity: number;
    voteType: 'vote' | 'support';
    paymentStatus: 'pending' | 'completed' | 'failed';
    supporterName?: string;
    supporterPhone?: string;
    isAnonymous?: boolean;
    createdAt: string;
}
export interface FundSummary {
    totalCollected: number;
    winnerPayout: number;
    lotteryPool: number;
    commission: number;
    winner: { name: string; projectName: string; userId?: string } | null;
}

export const listChallenges = async (page: number, limit: number): Promise<{ challenges: Challenge[]; total: number }> =>
    (await apiClient.get('/challenges/admin', { params: { page, limit } })).data.data;
export const getChallenge = async (id: string): Promise<{ challenge: Challenge; entrepreneurs: Entrepreneur[] }> =>
    (await apiClient.get(`/challenges/admin/${id}`)).data.data;
export const createChallenge = async (d: { campaignName: string; month: number; year: number; startDate: string; endDate: string; description: { fr: string; en: string } }): Promise<Challenge> =>
    (await apiClient.post('/challenges/admin', d)).data.data;
export const updateChallenge = (id: string, d: { campaignName?: string; startDate?: string; endDate?: string; description?: { fr: string; en: string } }) =>
    apiClient.patch(`/challenges/admin/${id}`, d);
export const setChallengeStatus = (id: string, status: 'active' | 'cancelled') => apiClient.patch(`/challenges/admin/${id}/status`, { status });
export const closeVoting = (id: string) => apiClient.post(`/challenges/admin/${id}/close-voting`);
export const getFundSummary = async (id: string): Promise<FundSummary> => (await apiClient.get(`/challenges/admin/${id}/fund-summary`)).data.data;
export const distributeFunds = (id: string) => apiClient.post(`/challenges/admin/${id}/distribute-funds`);
export const deleteChallenge = (id: string) => apiClient.delete(`/challenges/admin/${id}`);
export const listVotes = async (id: string, page: number, limit: number): Promise<{ votes: Vote[]; total: number }> =>
    (await apiClient.get(`/challenges/admin/${id}/votes`, { params: { page, limit } })).data.data;

export type EntrepreneurInput = Omit<Entrepreneur, '_id' | 'challengeId' | 'voteCount' | 'totalAmount' | 'rank' | 'isWinner' | 'approved'>;
export const addEntrepreneur = (challengeId: string, d: EntrepreneurInput) => apiClient.post(`/challenges/admin/${challengeId}/entrepreneurs`, d);
export const updateEntrepreneur = (id: string, d: Partial<EntrepreneurInput>) => apiClient.patch(`/challenges/admin/entrepreneurs/${id}`, d);
export const approveEntrepreneur = (id: string) => apiClient.patch(`/challenges/admin/entrepreneurs/${id}/approve`);
export const deleteEntrepreneur = (id: string) => apiClient.delete(`/challenges/admin/entrepreneurs/${id}`);

export const STATUS: Record<ChallengeStatus, [string, Tone]> = {
    draft: ['Brouillon', 'neutral'],
    active: ['Votes ouverts', 'success'],
    voting_closed: ['Votes clos', 'warning'],
    funds_distributed: ['Fonds versés', 'primary'],
    cancelled: ['Annulé', 'danger'],
};
export const PAYMENT: Record<string, [string, Tone]> = { completed: ['Payé', 'success'], pending: ['En attente', 'warning'], failed: ['Échoué', 'danger'] };

/** The model stores a bilingual description; older records may hold a plain string. */
export const descriptionFr = (d: Challenge['description']) => (typeof d === 'string' ? d : d?.fr ?? '');
