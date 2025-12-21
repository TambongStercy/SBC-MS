import apiClient from '../api/apiClient';
import { AxiosError } from 'axios';

// --- Enums & Interfaces (mirroring backend) ---

export enum ChallengeStatus {
    DRAFT = 'draft',
    ACTIVE = 'active',
    VOTING_CLOSED = 'voting_closed',
    FUNDS_DISTRIBUTED = 'funds_distributed',
    CANCELLED = 'cancelled',
}

export enum VoteType {
    VOTE = 'vote',
    SUPPORT = 'support',
}

export enum VotePaymentStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
}

export interface Entrepreneur {
    _id: string;
    challengeId: string;
    name: string;
    projectTitle: string;
    description: string;
    profileImageUrl?: string;
    videoUrl?: string;
    videoDurationSeconds?: number;
    videoUploadedAt?: string;
    voteCount: number;
    supportCount: number;
    amountCollected: number;
    rank?: number;
    approved: boolean;
    approvedAt?: string;
    approvedBy?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ImpactChallenge {
    _id: string;
    campaignName: string;
    month: number;
    year: number;
    status: ChallengeStatus;
    startDate: string;
    endDate: string;
    description?: string;
    tombolaMonthId: string;
    totalCollected: number;
    totalVoteCount: number;
    fundsDistributed: boolean;
    distributedAt?: string;
    distributedBy?: string;
    winnerAmountDistributed?: number;
    lotteryPoolAmount?: number;
    sbcCommissionAmount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface ChallengeVote {
    _id: string;
    challengeId: string;
    entrepreneurId: string;
    userId?: string;
    amountPaid: number;
    voteQuantity: number;
    voteType: VoteType;
    paymentStatus: VotePaymentStatus;
    paymentIntentId?: string;
    supporterName?: string;
    supporterEmail?: string;
    supporterPhone?: string;
    supportMessage?: string;
    isAnonymous: boolean;
    tombolaTicketIds: string[];
    ticketsGenerated: boolean;
    ticketGenerationError?: string;
    paidAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface FundDistributionPreview {
    challenge: {
        _id: string;
        campaignName: string;
        totalCollected: number;
    };
    winner: {
        _id: string;
        name: string;
        projectTitle: string;
        amountToReceive: number;
        percentage: number;
    };
    lotteryPool: {
        amount: number;
        percentage: number;
    };
    sbcCommission: {
        amount: number;
        percentage: number;
    };
}

export interface FundDistributionResult {
    challengeId: string;
    winnerId: string;
    winnerAmount: number;
    lotteryPoolAmount: number;
    sbcCommissionAmount: number;
    distributedAt: string;
    distributedBy: string;
}

// Generic Pagination Options
export interface PaginationOptions {
    page?: number;
    limit?: number;
}

// Response interfaces
interface ChallengeListResponse {
    success: boolean;
    data: ImpactChallenge[];
    pagination: {
        totalCount: number;
        page: number;
        totalPages: number;
        limit?: number;
        hasNextPage?: boolean;
        hasPrevPage?: boolean;
    };
    message?: string;
}

interface ChallengeActionResponse<T = ImpactChallenge> {
    success: boolean;
    data?: T;
    message?: string;
}

interface EntrepreneurListResponse {
    success: boolean;
    data: Entrepreneur[];
    pagination: {
        totalCount: number;
        page: number;
        totalPages: number;
    };
    message?: string;
}

interface VoteListResponse {
    success: boolean;
    data: ChallengeVote[];
    pagination: {
        totalCount: number;
        page: number;
        totalPages: number;
    };
    message?: string;
}

// --- Helper function ---
const handleError = (error: unknown, defaultMessage: string): string => {
    if (error instanceof AxiosError && error.response?.data?.message) {
        return error.response.data.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return defaultMessage;
};

// --- Challenge API Functions ---

/**
 * List all Impact Challenges (Admin)
 */
export const listChallenges = async (pagination: PaginationOptions = {}): Promise<ChallengeListResponse> => {
    console.log('[API] Listing Impact Challenges with pagination:', pagination);
    try {
        const response = await apiClient.get<ChallengeListResponse>('/challenges/admin', { params: pagination });
        console.log('[API] Challenges List Response:', response.data);

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch challenges');
        }

        return response.data;
    } catch (error) {
        console.error('[API] Error listing Impact Challenges:', error);
        throw new Error(handleError(error, 'Failed to fetch challenges list'));
    }
};

/**
 * Get a specific Impact Challenge by ID (Admin)
 */
export const getChallengeById = async (challengeId: string): Promise<ImpactChallenge> => {
    console.log(`[API] Getting Impact Challenge: ${challengeId}`);
    try {
        const response = await apiClient.get<ChallengeActionResponse>(`/challenges/admin/${challengeId}`);
        console.log('[API] Get Challenge Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to fetch challenge');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error getting Impact Challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to fetch challenge details'));
    }
};

/**
 * Create a new Impact Challenge (Admin)
 */
export const createChallenge = async (data: {
    campaignName: string;
    month: number;
    year: number;
    startDate: string;
    endDate: string;
    description?: string;
}): Promise<ImpactChallenge> => {
    console.log('[API] Creating Impact Challenge:', data);
    try {
        const response = await apiClient.post<ChallengeActionResponse>('/challenges/admin', data);
        console.log('[API] Create Challenge Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to create challenge');
        }

        return response.data.data;
    } catch (error) {
        console.error('[API] Error creating Impact Challenge:', error);
        throw new Error(handleError(error, 'Failed to create challenge'));
    }
};

/**
 * Update an Impact Challenge (Admin)
 */
export const updateChallenge = async (challengeId: string, data: Partial<{
    campaignName: string;
    description: string;
    startDate: string;
    endDate: string;
}>): Promise<ImpactChallenge> => {
    console.log(`[API] Updating Impact Challenge ${challengeId}:`, data);
    try {
        const response = await apiClient.patch<ChallengeActionResponse>(`/challenges/admin/${challengeId}`, data);
        console.log('[API] Update Challenge Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to update challenge');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error updating Impact Challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to update challenge'));
    }
};

/**
 * Update Challenge Status (Admin)
 */
export const updateChallengeStatus = async (challengeId: string, status: ChallengeStatus): Promise<ImpactChallenge> => {
    console.log(`[API] Updating Challenge ${challengeId} status to ${status}`);
    try {
        const response = await apiClient.patch<ChallengeActionResponse>(`/challenges/admin/${challengeId}/status`, { status });
        console.log('[API] Update Status Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to update challenge status');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error updating Challenge status:`, error);
        throw new Error(handleError(error, 'Failed to update challenge status'));
    }
};

/**
 * Delete an Impact Challenge (Admin)
 */
export const deleteChallenge = async (challengeId: string): Promise<{ success: boolean; message?: string }> => {
    console.log(`[API] Deleting Impact Challenge: ${challengeId}`);
    try {
        const response = await apiClient.delete<{ success: boolean; message?: string }>(`/challenges/admin/${challengeId}`);
        console.log('[API] Delete Challenge Response:', response.data);

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to delete challenge');
        }

        return response.data;
    } catch (error) {
        console.error(`[API] Error deleting Impact Challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to delete challenge'));
    }
};

// --- Entrepreneur API Functions ---

/**
 * List entrepreneurs for a challenge (Admin)
 */
export const listEntrepreneurs = async (
    challengeId: string,
    pagination: PaginationOptions = {},
    includeUnapproved: boolean = true
): Promise<EntrepreneurListResponse> => {
    console.log(`[API] Listing Entrepreneurs for challenge ${challengeId}`);
    try {
        const response = await apiClient.get<EntrepreneurListResponse>(
            `/challenges/admin/${challengeId}/entrepreneurs`,
            { params: { ...pagination, includeUnapproved } }
        );
        console.log('[API] Entrepreneurs List Response:', response.data);

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch entrepreneurs');
        }

        return response.data;
    } catch (error) {
        console.error(`[API] Error listing Entrepreneurs for challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to fetch entrepreneurs list'));
    }
};

/**
 * Add a new Entrepreneur to a Challenge (Admin)
 */
export const addEntrepreneur = async (challengeId: string, data: {
    name: string;
    projectTitle: string;
    description: string;
    profileImageUrl?: string;
}): Promise<Entrepreneur> => {
    console.log(`[API] Adding Entrepreneur to challenge ${challengeId}:`, data);
    try {
        const response = await apiClient.post<ChallengeActionResponse<Entrepreneur>>(
            `/challenges/admin/${challengeId}/entrepreneurs`,
            data
        );
        console.log('[API] Add Entrepreneur Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to add entrepreneur');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error adding Entrepreneur:`, error);
        throw new Error(handleError(error, 'Failed to add entrepreneur'));
    }
};

/**
 * Update an Entrepreneur (Admin)
 */
export const updateEntrepreneur = async (entrepreneurId: string, data: Partial<{
    name: string;
    projectTitle: string;
    description: string;
    profileImageUrl: string;
}>): Promise<Entrepreneur> => {
    console.log(`[API] Updating Entrepreneur ${entrepreneurId}:`, data);
    try {
        const response = await apiClient.patch<ChallengeActionResponse<Entrepreneur>>(
            `/challenges/admin/entrepreneurs/${entrepreneurId}`,
            data
        );
        console.log('[API] Update Entrepreneur Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to update entrepreneur');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error updating Entrepreneur:`, error);
        throw new Error(handleError(error, 'Failed to update entrepreneur'));
    }
};

/**
 * Approve an Entrepreneur (Admin)
 */
export const approveEntrepreneur = async (entrepreneurId: string): Promise<Entrepreneur> => {
    console.log(`[API] Approving Entrepreneur: ${entrepreneurId}`);
    try {
        const response = await apiClient.post<ChallengeActionResponse<Entrepreneur>>(
            `/challenges/admin/entrepreneurs/${entrepreneurId}/approve`
        );
        console.log('[API] Approve Entrepreneur Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to approve entrepreneur');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error approving Entrepreneur:`, error);
        throw new Error(handleError(error, 'Failed to approve entrepreneur'));
    }
};

/**
 * Delete an Entrepreneur (Admin)
 */
export const deleteEntrepreneur = async (entrepreneurId: string): Promise<{ success: boolean; message?: string }> => {
    console.log(`[API] Deleting Entrepreneur: ${entrepreneurId}`);
    try {
        const response = await apiClient.delete<{ success: boolean; message?: string }>(
            `/challenges/admin/entrepreneurs/${entrepreneurId}`
        );
        console.log('[API] Delete Entrepreneur Response:', response.data);

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to delete entrepreneur');
        }

        return response.data;
    } catch (error) {
        console.error(`[API] Error deleting Entrepreneur:`, error);
        throw new Error(handleError(error, 'Failed to delete entrepreneur'));
    }
};

// --- Vote API Functions ---

/**
 * List votes for a challenge (Admin)
 */
export const listVotes = async (
    challengeId: string,
    pagination: PaginationOptions = {},
    filters?: {
        entrepreneurId?: string;
        voteType?: VoteType;
    }
): Promise<VoteListResponse> => {
    console.log(`[API] Listing Votes for challenge ${challengeId}`);
    try {
        const response = await apiClient.get<VoteListResponse>(
            `/challenges/admin/${challengeId}/votes`,
            { params: { ...pagination, ...filters } }
        );
        console.log('[API] Votes List Response:', response.data);

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch votes');
        }

        return response.data;
    } catch (error) {
        console.error(`[API] Error listing Votes for challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to fetch votes list'));
    }
};

// --- Fund Distribution API Functions ---

/**
 * Preview fund distribution for a challenge (Admin)
 */
export const previewFundDistribution = async (challengeId: string): Promise<FundDistributionPreview> => {
    console.log(`[API] Previewing fund distribution for challenge ${challengeId}`);
    try {
        const response = await apiClient.get<ChallengeActionResponse<FundDistributionPreview>>(
            `/challenges/admin/${challengeId}/distribute/preview`
        );
        console.log('[API] Distribution Preview Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to generate distribution preview');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error previewing fund distribution:`, error);
        throw new Error(handleError(error, 'Failed to preview fund distribution'));
    }
};

/**
 * Execute fund distribution for a challenge (Admin)
 */
export const executeFundDistribution = async (challengeId: string): Promise<FundDistributionResult> => {
    console.log(`[API] Executing fund distribution for challenge ${challengeId}`);
    try {
        const response = await apiClient.post<ChallengeActionResponse<FundDistributionResult>>(
            `/challenges/admin/${challengeId}/distribute`
        );
        console.log('[API] Distribution Execution Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to distribute funds');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error executing fund distribution:`, error);
        throw new Error(handleError(error, 'Failed to distribute funds'));
    }
};

// --- Analytics API Functions ---

/**
 * Get analytics for a challenge (Admin)
 */
export const getChallengeAnalytics = async (challengeId: string): Promise<{
    totalVotes: number;
    totalSupports: number;
    totalAmount: number;
    uniqueVoters: number;
    uniqueSupporters: number;
    averageVoteAmount: number;
    voteDistribution: Array<{ entrepreneurId: string; entrepreneurName: string; votes: number; amount: number }>;
    dailyStats: Array<{ date: string; votes: number; supports: number; amount: number }>;
}> => {
    console.log(`[API] Getting analytics for challenge ${challengeId}`);
    try {
        const response = await apiClient.get<ChallengeActionResponse<{
            totalVotes: number;
            totalSupports: number;
            totalAmount: number;
            uniqueVoters: number;
            uniqueSupporters: number;
            averageVoteAmount: number;
            voteDistribution: Array<{ entrepreneurId: string; entrepreneurName: string; votes: number; amount: number }>;
            dailyStats: Array<{ date: string; votes: number; supports: number; amount: number }>;
        }>>(`/challenges/admin/${challengeId}/analytics`);
        console.log('[API] Analytics Response:', response.data);

        if (!response.data?.success || !response.data.data) {
            throw new Error(response.data?.message || 'Failed to fetch analytics');
        }

        return response.data.data;
    } catch (error) {
        console.error(`[API] Error getting analytics for challenge ${challengeId}:`, error);
        throw new Error(handleError(error, 'Failed to fetch challenge analytics'));
    }
};
