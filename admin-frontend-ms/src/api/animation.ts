import apiClient from './apiClient';

/**
 * SBC Event — "Animation & Engagement" module, SBC administration API.
 *
 * Mounted by event-service at /tickets/admin/animation (gateway prefix /api).
 * Every route requires an admin role. Responses are `{ success, data }`;
 * errors `{ success: false, message, code?, details? }`.
 */

const BASE = '/tickets/admin/animation';

// ---------- vocabulary ----------

export type ChallengeStatus =
    | 'DRAFT' | 'PROGRAMMED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'ACTIVE'
    | 'VOTING_OPEN' | 'VOTING_CLOSED' | 'RESULTS_PENDING' | 'COMPLETED' | 'CANCELLED';
export const CHALLENGE_STATUSES: ChallengeStatus[] = [
    'DRAFT', 'PROGRAMMED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE',
    'VOTING_OPEN', 'VOTING_CLOSED', 'RESULTS_PENDING', 'COMPLETED', 'CANCELLED',
];
export const CHALLENGE_STATUS_LABELS: Record<ChallengeStatus, string> = {
    DRAFT: 'Brouillon',
    PROGRAMMED: 'Programmé',
    REGISTRATION_OPEN: 'Inscriptions ouvertes',
    REGISTRATION_CLOSED: 'Inscriptions closes',
    ACTIVE: 'En cours',
    VOTING_OPEN: 'Votes ouverts',
    VOTING_CLOSED: 'Votes clos',
    RESULTS_PENDING: 'Résultats en attente',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
};

export type VoteTxStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export const VOTE_TX_STATUSES: VoteTxStatus[] = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'];
export const VOTE_TX_STATUS_LABELS: Record<VoteTxStatus, string> = {
    PENDING: 'En attente', SUCCESS: 'Payé', FAILED: 'Échoué', CANCELLED: 'Annulé', REFUNDED: 'Remboursé',
};

export type FraudReview = 'NONE' | 'PENDING' | 'CLEARED' | 'CONFIRMED';
export const FRAUD_REVIEWS: FraudReview[] = ['NONE', 'PENDING', 'CLEARED', 'CONFIRMED'];
export const FRAUD_REVIEW_LABELS: Record<FraudReview, string> = {
    NONE: 'Aucune', PENDING: 'À vérifier', CLEARED: 'Classée', CONFIRMED: 'Fraude confirmée',
};

export type FraudFlagStatus = 'OPEN' | 'CLEARED' | 'CONFIRMED';
export const FRAUD_FLAG_STATUS_LABELS: Record<FraudFlagStatus, string> = {
    OPEN: 'À vérifier', CLEARED: 'Classé sans suite', CONFIRMED: 'Fraude confirmée',
};

export type FraudSubjectType = 'USER' | 'TRANSACTION' | 'CANDIDATE' | 'IP';
export const FRAUD_SUBJECT_LABELS: Record<FraudSubjectType, string> = {
    USER: 'Compte', TRANSACTION: 'Transaction', CANDIDATE: 'Candidat', IP: 'Réseau / appareil',
};

/** Signal codes raised by event-service's fraud.service (thresholds live there). */
export const FRAUD_SIGNAL_LABELS: Record<string, { label: string; help: string; unit?: string }> = {
    PURCHASE_VELOCITY: {
        label: 'Achats trop rapprochés',
        help: 'Un même compte a lancé plus d’achats de votes que le seuil autorisé en une heure sur ce défi.',
        unit: 'achats / h',
    },
    FAILED_PAYMENT_BURST: {
        label: 'Rafale de paiements échoués',
        help: 'Beaucoup de paiements échoués ou annulés en une heure : test de moyens de paiement ou robot possible.',
        unit: 'échecs / h',
    },
    VOLUME_SHARE: {
        label: 'Achat dominant',
        help: 'Un seul achat représente une part anormale de tous les votes du défi.',
        unit: '% des votes',
    },
    SHARED_IP: {
        label: 'Adresse réseau partagée',
        help: 'De nombreux comptes différents votent depuis la même adresse réseau (multi-comptes ou robots).',
        unit: 'comptes / h',
    },
    SHARED_DEVICE: {
        label: 'Appareil partagé',
        help: 'De nombreux comptes votent avec la même signature d’appareil / navigateur.',
        unit: 'comptes / h',
    },
    CANDIDATE_BURST: {
        label: 'Pic soudain pour un candidat',
        help: 'Un candidat a capté la grande majorité des votes gratuits des 15 dernières minutes.',
        unit: '% des votes',
    },
    AMOUNT_MISMATCH: {
        label: 'Montant incohérent',
        help: 'Le prestataire a confirmé un montant différent du prix du pack : les votes n’ont pas été crédités.',
        unit: 'XAF',
    },
};

export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
    PENDING: 'En attente', APPROVED: 'Approuvée', REJECTED: 'Refusée',
};

export type ResultStatus = 'COMPUTED' | 'AWAITING_TIE_DECISION' | 'AWAITING_SECOND_ROUND' | 'FROZEN';
export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
    COMPUTED: 'Calculé',
    AWAITING_TIE_DECISION: 'Égalité à départager',
    AWAITING_SECOND_ROUND: 'Second tour en attente',
    FROZEN: 'Figé',
};

export const REWARD_WINNER_STATUS_LABELS: Record<string, string> = {
    AWARDED: 'Attribuées', DELIVERED: 'Remises', FORFEITED: 'Perdues', REVOKED: 'Révoquées',
};

export const VOTING_MODE_LABELS: Record<string, string> = {
    NONE: 'Sans vote', FREE: 'Gratuit', PAID: 'Payant', FREE_AND_PAID: 'Gratuit + payant',
    JURY: 'Jury', PUBLIC_AND_JURY: 'Public + jury',
};

// ---------- shapes ----------

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface AnimEventRef { _id: string; title: string; slug?: string; status?: string }

export interface AnimationStats {
    eventsUsingModule: number;
    challenges: { total: number; byStatus: Partial<Record<ChallengeStatus, number>> };
    candidates: number;
    votes: { free: number; paid: number };
    paid: { transactions: number; volume: number; commission: number; refunded: number; pending: number };
    rewards: Record<string, number>;
    openFraudFlags: number;
    perEvent: { _id: string; title?: string; challenges: number; votes: number; revenue: number }[];
    perOrganizer: { _id: string; name?: string; challenges: number; votes: number; revenue: number }[];
}

export interface AnimChallenge {
    _id: string;
    organizerId: string;
    eventId: string;
    slug: string;
    name: string;
    description?: string;
    status: ChallengeStatus;
    statusHistory?: { from: string; to: string; at: string; by?: string; reason?: string }[];
    suspendedAt?: string;
    suspendedReason?: string;
    schedule?: {
        registrationOpensAt?: string; registrationClosesAt?: string; startsAt?: string;
        votingOpensAt?: string; votingClosesAt?: string; endsAt?: string; settlementGraceMin?: number;
    };
    participation?: { mode: string; requiresApproval: boolean; maxCandidates: number; categories: string[] };
    voting?: {
        mode: string; voterScope: string;
        free?: { perPeriod: number; period: string; perCandidatePerPeriod?: number; totalPerChallenge?: number };
        selfVoteAllowed?: boolean; showVoteCounts?: boolean;
    };
    scoring?: { method: string; publicWeight: number; juryWeight: number };
    tieRule?: string;
    counters: {
        candidates: number; approved: number; freeVotes: number; paidVotes: number;
        paidRevenue: number; paidTransactions: number;
    };
    cancellation?: { reason: string; at: string; by: string; refundedTransactions: number };
    createdAt: string;
    updatedAt: string;
    /** Joined by the list route. */
    event?: AnimEventRef;
}

export interface BoardEntry {
    candidateId: string;
    number: number;
    displayName: string;
    photoFileId?: string;
    category?: string;
    rank: number;
    score?: number;
    publicScore?: number;
    juryScore?: number;
    totalVotes?: number;
    freeVotes?: number;
    paidVotes?: number;
}

/**
 * The admin detail route returns only `{ entries (top 50), totals }`, with real
 * counts even when the organizer hides them from the public; the other fields
 * belong to the public board and are optional here.
 */
export interface AnimBoard {
    challengeId?: string;
    status?: ChallengeStatus;
    version?: number;
    computedAt?: string;
    showVoteCounts?: boolean;
    scoringMethod?: string;
    totals: { candidates: number; votes: number };
    entries: BoardEntry[];
}

export interface AnimResult {
    _id: string;
    status: ResultStatus;
    computedAt: string;
    frozenAt?: string;
    publishedAt?: string;
    inputsHash: string;
    ties: { rank: number; candidateIds: string[] }[];
    entries: { candidateId: string; number: number; displayName: string; totalVotes: number; score: number; rank: number; sharedRank?: boolean }[];
}

export interface FraudSignal { code: string; value: number; threshold: number; note?: string }

export interface AnimFraudFlag {
    _id: string;
    organizerId: string;
    eventId: string;
    challengeId: string;
    subjectType: FraudSubjectType;
    subjectId: string;
    /** Name/contact of the account, buyer of the purchase, or the candidate. */
    subjectLabel?: string;
    signals: FraudSignal[];
    score: number;
    status: FraudFlagStatus;
    reviewedBy?: string;
    reviewNote?: string;
    reviewedAt?: string;
    createdAt: string;
    updatedAt: string;
    /** Joined by the list route. */
    challenge?: { _id: string; name: string; eventId: string };
}

export interface ChallengeDetail {
    challenge: AnimChallenge;
    event: AnimEventRef | null;
    board: AnimBoard | null;
    result: AnimResult | null;
    flags: AnimFraudFlag[];
}

export interface AnimChangeRequest {
    _id: string;
    organizerId: string;
    eventId: string;
    targetType: 'CHALLENGE' | 'REWARD' | 'PACKAGE';
    targetId: string;
    patch: Record<string, unknown>;
    diff: { path: string; from: unknown; to: unknown }[];
    reason: string;
    requestedBy: string;
    status: ChangeRequestStatus;
    reviewedBy?: string;
    reviewNote?: string;
    reviewedAt?: string;
    createdAt: string;
    event?: AnimEventRef;
    /** Resolved by the admin list endpoint. */
    organizerName?: string;
    targetName?: string;
    requester?: { name?: string; contact?: string };
    reviewer?: { name?: string; contact?: string };
    /** Names for ids found inside the diff values (ticket types, rewards…). */
    valueNames?: Record<string, string>;
}

export interface AnimVoteTransaction {
    _id: string;
    /** Resolved by the admin list endpoint. */
    challengeName?: string;
    eventTitle?: string;
    organizerId: string;
    eventId: string;
    challengeId: string;
    candidateId: string;
    userId: string;
    packageSnapshot?: { label: string; votes: number; price: number };
    votes: number;
    amount: number;
    currency: string;
    commissionRate: number;
    commissionAmount: number;
    organizerNet: number;
    status: VoteTxStatus;
    paymentSessionId?: string;
    providerStatus?: string;
    paymentMethod?: string;
    lateSettlement?: boolean;
    settledAt?: string;
    refundedAt?: string;
    fraud?: { score: number; flags: string[]; review: FraudReview };
    createdAt: string;
}

export interface AnimAuditEntry {
    _id: string;
    organizerId?: string;
    eventId?: string;
    challengeId?: string;
    actorUserId?: string | null;
    actorRole: string;
    action: string;
    targetType: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    ip?: string;
    at: string;
}

// ---------- calls ----------

export async function getAnimationStats(params: { from?: string; to?: string } = {}) {
    const { data } = await apiClient.get(`${BASE}/stats`, { params });
    return data.data as AnimationStats;
}

export async function listAnimationChallenges(params: { status?: ChallengeStatus; q?: string; page?: number; limit?: number } = {}) {
    const { data } = await apiClient.get(`${BASE}/challenges`, { params });
    return data.data as Paginated<AnimChallenge>;
}

export async function getAnimationChallenge(id: string) {
    const { data } = await apiClient.get(`${BASE}/challenges/${id}`);
    return data.data as ChallengeDetail;
}

export async function suspendAnimationChallenge(id: string, reason: string) {
    const { data } = await apiClient.post(`${BASE}/challenges/${id}/suspend`, { reason });
    return data.data as AnimChallenge;
}

export async function resumeAnimationChallenge(id: string) {
    const { data } = await apiClient.post(`${BASE}/challenges/${id}/resume`);
    return data.data as AnimChallenge;
}

export async function cancelAnimationChallenge(id: string, reason: string) {
    const { data } = await apiClient.post(`${BASE}/challenges/${id}/cancel`, { reason });
    return data.data as { challenge: AnimChallenge; refundedTransactions: number };
}

export async function freezeAnimationResult(id: string) {
    const { data } = await apiClient.post(`${BASE}/challenges/${id}/freeze`);
    return data.data as AnimResult;
}

export async function listFraudFlags(params: { status?: FraudFlagStatus; page?: number; limit?: number } = {}) {
    const { data } = await apiClient.get(`${BASE}/fraud`, { params });
    return data.data as Paginated<AnimFraudFlag>;
}

export interface FraudReviewPayload {
    decision: 'clear' | 'confirm';
    note?: string;
    voidVotes?: boolean;
    refund?: boolean;
    disqualify?: boolean;
}

export async function reviewFraudFlag(id: string, payload: FraudReviewPayload) {
    const { data } = await apiClient.post(`${BASE}/fraud/${id}/review`, payload);
    return data.data as { flag: AnimFraudFlag; result: { voidedFreeVotes?: number; refunded?: number; disqualified?: number } };
}

export async function listChangeRequests(params: { status?: ChangeRequestStatus } = {}) {
    const { data } = await apiClient.get(`${BASE}/change-requests`, { params });
    return data.data as AnimChangeRequest[];
}

export async function reviewChangeRequest(id: string, approve: boolean, note?: string) {
    const { data } = await apiClient.post(`${BASE}/change-requests/${id}/review`, { approve, note });
    return data.data as AnimChangeRequest;
}

export async function listVoteTransactions(params: {
    status?: VoteTxStatus; review?: FraudReview; challengeId?: string; page?: number; limit?: number;
} = {}) {
    const { data } = await apiClient.get(`${BASE}/transactions`, { params });
    return data.data as Paginated<AnimVoteTransaction>;
}

export interface AnimVoteRefund {
    _id: string;
    voteTransactionId: string;
    challengeId: string;
    userId: string;
    amount: number;
    reason: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    attempts: number;
    lastError?: string;
    walletCreditedAt?: string;
    organizerDebitedAt?: string;
    updatedAt: string;
}

/** Refunds whose money side hasn't completed yet (retried by the job every 30 s). */
export async function listStuckRefunds() {
    const { data } = await apiClient.get(`${BASE}/refunds`);
    return data.data as AnimVoteRefund[];
}

export async function retryRefund(voteTransactionId: string) {
    const { data } = await apiClient.post(`${BASE}/refunds/${voteTransactionId}/retry`);
    return data.data as AnimVoteRefund;
}

export async function refundVoteTransaction(id: string, reason: string) {
    const { data } = await apiClient.post(`${BASE}/transactions/${id}/refund`, { reason });
    return data.data;
}

export async function listAnimationAudit(params: {
    eventId?: string; challengeId?: string; action?: string; page?: number; limit?: number;
} = {}) {
    const { data } = await apiClient.get(`${BASE}/audit`, { params });
    return data.data as Paginated<AnimAuditEntry>;
}

// ---------- exports ----------

export type ExportKind = 'candidates' | 'votes' | 'transactions' | 'leaderboard' | 'results' | 'winners' | 'audit';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
    leaderboard: 'Classement',
    results: 'Résultats',
    winners: 'Gagnants',
    transactions: 'Transactions',
    votes: 'Votes',
    candidates: 'Candidats',
    audit: 'Journal',
};
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];

export interface ExportScope { eventId?: string; challengeId?: string }

/** Path (relative to the apiClient base URL) of an export. */
export function animationExportPath(kind: ExportKind, format: ExportFormat, scope: ExportScope = {}) {
    const qs = new URLSearchParams();
    if (scope.eventId) qs.set('eventId', scope.eventId);
    if (scope.challengeId) qs.set('challengeId', scope.challengeId);
    const q = qs.toString();
    return `${BASE}/exports/${kind}.${format}${q ? `?${q}` : ''}`;
}

/** Absolute URL of an export (it needs the admin bearer token: use downloadAnimationExport to open it). */
export function animationExportUrl(kind: ExportKind, format: ExportFormat, scope: ExportScope = {}) {
    const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '');
    return `${base}${animationExportPath(kind, format, scope)}`;
}

/** The server answers errors as JSON even on a blob request: surface its message. */
async function blobErrorMessage(err: unknown): Promise<string | null> {
    const blob = (err as { response?: { data?: unknown } })?.response?.data;
    if (blob instanceof Blob) {
        try {
            const body = JSON.parse(await blob.text());
            return typeof body?.message === 'string' ? body.message : null;
        } catch { return null; }
    }
    return null;
}

/**
 * Fetches an export through apiClient (which attaches the admin token from
 * localStorage) and saves it. Throws an Error carrying the server's message.
 */
export async function downloadAnimationExport(kind: ExportKind, format: ExportFormat, scope: ExportScope = {}) {
    let res;
    try {
        res = await apiClient.get(animationExportPath(kind, format, scope), { responseType: 'blob' });
    } catch (err) {
        throw new Error((await blobErrorMessage(err)) || 'Export impossible.');
    }
    const disposition = String(res.headers?.['content-disposition'] ?? '');
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : `animation-${kind}.${format}`;
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Short alias. */
export const downloadExport = downloadAnimationExport;

// ---------- helpers ----------

export const xaf = (n?: number | null) => typeof n === 'number' ? `${Math.round(n).toLocaleString('fr-FR')} XAF` : '—';
export const num = (n?: number | null) => typeof n === 'number' ? n.toLocaleString('fr-FR') : '—';
export const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const shortId = (id?: string | null) => id ? `…${String(id).slice(-8)}` : '—';

/** Server error code (AppError.code), when present. */
export function apiErrorCode(err: unknown): string | undefined {
    return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}
