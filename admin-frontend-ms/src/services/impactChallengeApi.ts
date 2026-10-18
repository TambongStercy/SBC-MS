import axios from 'axios';
import apiClient from '../api/apiClient';

/**
 * Impact Challenge admin API (tombola-service, mounted at `/api/challenges`).
 *
 * Each month up to three entrepreneurs pitch in a video. Members pay to vote
 * (each vote also gives tickets for the same month's tombola), anyone can pay
 * to support. When voting closes the most-voted entrepreneur wins, and the
 * money collected is split 50 % winner, 30 % tombola pool, 20 % SBC.
 *
 * Every call and shape below is taken from
 * `tombola-service/src/api/routes/impact-challenge.routes.ts` and its
 * controller/services. Responses are `{ success, data, message }`.
 */

// --- Types (mirroring the tombola-service models) ---

export type ChallengeStatus = 'draft' | 'active' | 'voting_closed' | 'funds_distributed' | 'cancelled';

export interface Bilingual {
    fr: string;
    en: string;
}

export interface ImpactChallenge {
    _id: string;
    campaignName: string;
    month: number;
    year: number;
    status: ChallengeStatus;
    startDate: string;
    endDate: string;
    description: Bilingual;
    tombolaMonthId: string;
    totalCollected: number;
    totalVoteCount: number;
    fundsDistributed: boolean;
    distributionDate?: string;
    /** Fixed at the first payout attempt (50 %). */
    winnerPayoutAmount?: number;
    /** Fixed at the first payout attempt (30 %). */
    lotteryPoolAmount?: number;
    /** Fixed at the first payout attempt (20 % + rounding remainder). */
    commissionAmount?: number;
    /** Set as soon as that part of the payout succeeded. */
    winnerTransactionId?: string;
    lotteryTransactionId?: string;
    commissionTransactionId?: string;
    /** True while a payout is running, so a second click cannot start another. */
    distributionInProgress?: boolean;
    /** Money confirmed after voting closed: kept, not counted in the result. */
    lateCollected?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Entrepreneur {
    _id: string;
    challengeId: string;
    /** Linked SBC account — the winner's share is credited to it. */
    userId?: string;
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    city: string;
    projectName: string;
    projectDescription: Bilingual;
    businessCategory: string;
    videoUrl: string;
    videoFilename: string;
    videoDuration?: number;
    videoThumbnailUrl?: string;
    voteCount: number;
    totalAmount: number;
    rank?: number;
    isWinner: boolean;
    approved: boolean;
    approvedBy?: string;
    approvedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export type VoteType = 'vote' | 'support';
export type VotePaymentStatus = 'pending' | 'completed' | 'failed';

export interface ChallengeVote {
    _id: string;
    challengeId: string;
    entrepreneurId: string;
    userId?: string;
    amountPaid: number;
    voteQuantity: number;
    paymentIntentId?: string;
    paymentStatus: VotePaymentStatus;
    voteType: VoteType;
    supporterName?: string;
    supporterEmail?: string;
    supporterPhone?: string;
    supportMessage?: string;
    isAnonymous: boolean;
    tombolaTicketIds: string[];
    ticketsGenerated: boolean;
    ticketGenerationError?: string;
    /** Paid after voting closed: the money is kept but the vote is not counted. */
    lateAfterClose?: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface FundSummary {
    totalCollected: number;
    winnerPayout: number;
    lotteryPool: number;
    /** 20 % plus the rounding remainder. */
    commission: number;
    winner: { name: string; projectName: string; userId?: string } | null;
}

export interface FundDistributionResult {
    success: boolean;
    distribution: { winnerPayout: number; lotteryPool: number; commission: number };
    transactionIds: { winner: string; lottery: string; commission: string };
}

export interface ChallengeAnalytics {
    totalVotes: number;
    totalAmount: number;
    /** Approved entrepreneurs only, most votes first. */
    entrepreneurBreakdown: Array<{ entrepreneurId: string; name: string; voteCount: number; totalAmount: number }>;
}

export interface ChallengeListResult {
    challenges: ImpactChallenge[];
    total: number;
    page: number;
    limit: number;
}

export interface CreateChallengeInput {
    campaignName: string;
    month: number;
    year: number;
    startDate: string;
    endDate: string;
    description: Bilingual;
}

/**
 * What the edit form changes. Month and year are left out on purpose: the
 * service accepts them on a draft but does not re-link the month's tombola
 * (and a taken month hits the unique index as a 500).
 */
export type UpdateChallengeInput = Partial<Omit<CreateChallengeInput, 'month' | 'year'>>;

export interface EntrepreneurInput {
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    city: string;
    projectName: string;
    projectDescription: Bilingual;
    businessCategory: string;
    videoUrl: string;
    videoFilename: string;
    videoDuration?: number;
    videoThumbnailUrl?: string;
    /** Linked SBC account id. `null` on update removes the link. */
    userId?: string | null;
}

// --- Constants the service enforces (config defaults in tombola-service) ---

export const MAX_ENTREPRENEURS = 3;
export const VIDEO_MAX_SECONDS = 90;
/** settings-service upload limit (multer + nginx + Cloudflare). */
export const VIDEO_MAX_MB = 100;

// --- Helpers ---

/** The service's own message is what should reach the admin, not "Request failed with status 400". */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err)) return err.response?.data?.message || err.message || fallback;
    return err instanceof Error && err.message ? err.message : fallback;
};

const unwrap = <T>(response: { data: { success?: boolean; data?: T; message?: string } }, fallback: string): T => {
    if (!response.data?.success || response.data.data === undefined) {
        throw new Error(response.data?.message || fallback);
    }
    return response.data.data;
};

// --- Challenges ---

export const listChallenges = async (page: number, limit: number, status?: ChallengeStatus): Promise<ChallengeListResult> => {
    const res = await apiClient.get('/challenges/admin', { params: { page, limit, ...(status ? { status } : {}) } });
    return unwrap<ChallengeListResult>(res, 'Impossible de charger les challenges.');
};

export const getChallengeDetails = async (challengeId: string): Promise<{ challenge: ImpactChallenge; entrepreneurs: Entrepreneur[] }> => {
    const res = await apiClient.get(`/challenges/admin/${challengeId}`);
    return unwrap(res, 'Impossible de charger ce challenge.');
};

export const createChallenge = async (input: CreateChallengeInput): Promise<ImpactChallenge> => {
    const res = await apiClient.post('/challenges/admin', input);
    return unwrap<ImpactChallenge>(res, 'Le challenge n’a pas pu être créé.');
};

export const updateChallenge = async (challengeId: string, input: UpdateChallengeInput): Promise<ImpactChallenge> => {
    const res = await apiClient.patch(`/challenges/admin/${challengeId}`, input);
    return unwrap<ImpactChallenge>(res, 'Le challenge n’a pas pu être modifié.');
};

/**
 * Only two status changes exist on their own: draft → active (open the votes)
 * and → cancelled (only while nothing was collected). Closing the votes and
 * paying out have their own calls below.
 */
export const updateChallengeStatus = async (challengeId: string, status: 'active' | 'cancelled'): Promise<ImpactChallenge> => {
    const res = await apiClient.patch(`/challenges/admin/${challengeId}/status`, { status });
    return unwrap<ImpactChallenge>(res, 'Le statut n’a pas pu être changé.');
};

/** Only a draft or cancelled challenge with no votes. */
export const deleteChallenge = async (challengeId: string): Promise<void> => {
    const res = await apiClient.delete(`/challenges/admin/${challengeId}`);
    if (!res.data?.success) throw new Error(res.data?.message || 'Le challenge n’a pas pu être supprimé.');
};

/** Stops the votes, ranks the approved entrepreneurs and names the winner. */
export const closeVoting = async (challengeId: string): Promise<ImpactChallenge> => {
    const res = await apiClient.post(`/challenges/admin/${challengeId}/close-voting`);
    return unwrap<ImpactChallenge>(res, 'Les votes n’ont pas pu être clôturés.');
};

/** Preview of the 50/30/20 split, from what has been collected so far. */
export const getFundSummary = async (challengeId: string): Promise<FundSummary> => {
    const res = await apiClient.get(`/challenges/admin/${challengeId}/fund-summary`);
    return unwrap<FundSummary>(res, 'Impossible de calculer la répartition.');
};

/**
 * Pays the three parts. If it stops part-way, the parts already paid keep
 * their transaction id on the challenge and calling again pays only the rest.
 */
export const distributeFunds = async (challengeId: string): Promise<FundDistributionResult> => {
    const res = await apiClient.post(`/challenges/admin/${challengeId}/distribute-funds`);
    return unwrap<FundDistributionResult>(res, 'Le versement n’a pas pu être fait.');
};

export const getChallengeAnalytics = async (challengeId: string): Promise<ChallengeAnalytics> => {
    const res = await apiClient.get(`/challenges/admin/${challengeId}/analytics`);
    return unwrap<ChallengeAnalytics>(res, 'Impossible de charger le classement.');
};

/** Paid votes and supports only, newest first. */
export const listVotes = async (challengeId: string, page: number, limit: number): Promise<{ votes: ChallengeVote[]; total: number }> => {
    const res = await apiClient.get(`/challenges/admin/${challengeId}/votes`, { params: { page, limit } });
    return unwrap(res, 'Impossible de charger les votes.');
};

// --- Entrepreneurs ---

export const addEntrepreneur = async (challengeId: string, input: EntrepreneurInput): Promise<Entrepreneur> => {
    const res = await apiClient.post(`/challenges/admin/${challengeId}/entrepreneurs`, input);
    return unwrap<Entrepreneur>(res, 'L’entrepreneur n’a pas pu être ajouté.');
};

export const updateEntrepreneur = async (entrepreneurId: string, input: Partial<EntrepreneurInput>): Promise<Entrepreneur> => {
    const res = await apiClient.patch(`/challenges/admin/entrepreneurs/${entrepreneurId}`, input);
    return unwrap<Entrepreneur>(res, 'L’entrepreneur n’a pas pu être modifié.');
};

export const approveEntrepreneur = async (entrepreneurId: string): Promise<Entrepreneur> => {
    const res = await apiClient.patch(`/challenges/admin/entrepreneurs/${entrepreneurId}/approve`);
    return unwrap<Entrepreneur>(res, 'L’entrepreneur n’a pas pu être approuvé.');
};

/** Only while the entrepreneur has no votes. */
export const deleteEntrepreneur = async (entrepreneurId: string): Promise<void> => {
    const res = await apiClient.delete(`/challenges/admin/entrepreneurs/${entrepreneurId}`);
    if (!res.data?.success) throw new Error(res.data?.message || 'L’entrepreneur n’a pas pu être retiré.');
};

// --- Video upload (settings-service generic upload) ---

/**
 * Absolute URL through our own origin (`/api/settings/files/<id>`), which sits
 * behind Cloudflare: the direct bucket URL is billed on every view. Absolute
 * because the stored URL is played by the member app, on another host.
 */
export const fileProxyUrl = (fileId: string): string => {
    const base = (apiClient.defaults.baseURL || '/api').replace(/\/+$/, '');
    const absoluteBase = /^https?:\/\//i.test(base) ? base : `${window.location.origin}${base.startsWith('/') ? '' : '/'}${base}`;
    return `${absoluteBase}/settings/files/${encodeURIComponent(fileId)}`;
};

export const uploadChallengeVideo = async (
    file: File,
    onProgress?: (percent: number) => void,
): Promise<{ fileId: string; url: string; fileName: string }> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.post('/settings/files/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // A large video on mobile data takes minutes; show progress instead of a hang.
        timeout: 15 * 60 * 1000,
        onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
    });
    const fileId: string | undefined = data?.data?.fileId;
    if (!fileId) throw new Error('La vidéo n’a pas pu être envoyée.');
    return { fileId, url: fileProxyUrl(fileId), fileName: file.name };
};

/**
 * Reads the video's length in the browser, before uploading anything.
 * Resolves `undefined` when the browser cannot read the file.
 */
export const readVideoDuration = (file: File): Promise<number | undefined> =>
    new Promise((resolve) => {
        const video = document.createElement('video');
        const src = URL.createObjectURL(file);
        const done = (value: number | undefined) => {
            URL.revokeObjectURL(src);
            resolve(value);
        };
        video.preload = 'metadata';
        video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? Math.round(video.duration) : undefined);
        video.onerror = () => done(undefined);
        video.src = src;
    });

// --- Display helpers ---

export const STATUS_LABELS: Record<ChallengeStatus, string> = {
    draft: 'Brouillon',
    active: 'Votes ouverts',
    voting_closed: 'Votes clôturés',
    funds_distributed: 'Fonds distribués',
    cancelled: 'Annulé',
};

export const STATUS_STYLES: Record<ChallengeStatus, string> = {
    draft: 'bg-gray-700 text-gray-200',
    active: 'bg-green-900/60 text-green-300',
    voting_closed: 'bg-yellow-900/60 text-yellow-300',
    funds_distributed: 'bg-blue-900/60 text-blue-300',
    cancelled: 'bg-red-900/60 text-red-300',
};

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const monthLabel = (month: number, year: number) => {
    const name = MONTHS_FR[month - 1] ?? String(month);
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
};

export const formatXaf = (amount?: number | null) => `${Math.round(amount ?? 0).toLocaleString('fr-FR')} FCFA`;

export const formatDay = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** `YYYY-MM-DD` (local day) for an `<input type="date">`, from a stored ISO date. */
export const toDateInput = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The service refuses votes outside [startDate, endDate] and closes the votes
 * an hour after endDate. A bare `YYYY-MM-DD` is midnight UTC, which would end
 * the challenge at the START of its last day — so the start is sent as the
 * beginning of that day and the end as the end of that day, in the admin's time.
 */
export const startOfDayIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
export const endOfDayIso = (day: string) => new Date(`${day}T23:59:59`).toISOString();
