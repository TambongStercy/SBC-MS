import apiClient from '../api/apiClient';
import axios from 'axios';

// --- Enums ---

export enum ProfileStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    SUSPENDED = 'suspended',
}

export enum ReportStatus {
    OPEN = 'open',
    REVIEWED = 'reviewed',
    DISMISSED = 'dismissed',
}

export enum Intention {
    RELATION_SERIEUSE = 'relation_serieuse',
    FAIRE_CONNAISSANCE = 'faire_connaissance',
    PROJET_MARIAGE = 'projet_mariage',
    ELARGIR_CERCLE_SOCIAL = 'elargir_cercle_social',
    ECHANGE_VALEURS_RESPECT = 'echange_valeurs_respect',
    AUTRE = 'autre',
}

// --- Interfaces ---

/**
 * A profile as the validation queue receives it: the photos as clear URLs, the
 * text to moderate, and the SBC member behind it — everything the decision
 * needs, hydrated server-side.
 */
export interface LoveProfile {
    _id: string;
    id: string;
    userId: string;
    displayName?: string;
    intention: Intention;
    otherIntentionText?: string;
    description?: string;
    photos: Array<{ fileId: string; url?: string; blurred: boolean; order: number }>;
    status: ProfileStatus;
    // Hydrated from user-service
    memberName?: string;
    memberEmail?: string;
    memberVerified?: boolean;
    memberSince?: string;
    sex?: string;
    ageBracket?: string | null;
    city?: string;
    country?: string;
    // Photo rule (spec §6): approval is refused below the minimum
    photoCount: number;
    minPhotos: number;
    meetsPhotoRequirement: boolean;
    moderation: {
        validatedBy?: string;
        validatedAt?: string;
        rejectionReason?: string;
        reportCount: number;
        suspendedAt?: string;
    };
    createdAt: string;
    updatedAt: string;
}

/** Both sides of a report, resolved server-side so the queue names people. */
export interface ReportParty {
    userId: string;
    displayName: string;
    email?: string;
    profileId?: string;
    profileStatus?: ProfileStatus;
    reportCount: number;
}

export interface Report {
    _id: string;
    reporterId: string;
    reportedUserId: string;
    reportedProfileId: string;
    reporter?: ReportParty;
    reported?: ReportParty;
    reason: string;
    status: ReportStatus;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ModuleConfig {
    _id: string;
    key: string;
    enabled: boolean;
    activeWeekday: number;
    openHour: number;
    closeHour: number;
    timezone: string;
    maxInterestsPerWeek: number;
    autoSuspendThreshold: number;
    autoApprove: boolean;
    updatedBy?: string;
    updatedAt: string;
}

export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

/** One row of the SBCLOVE member directory (with its match/conversation tally). */
export interface MemberRow {
    _id: string;
    userId: string;
    displayName: string;
    memberName?: string;
    memberEmail?: string;
    sex?: string;
    ageBracket?: string | null;
    city?: string;
    status: ProfileStatus;
    photoCount: number;
    photoUrl?: string;
    reportCount: number;
    matches: number;
    conversations: number;
    createdAt?: string;
}

export interface SbcLoveStats {
    profiles: { total: number; pending: number; approved: number; rejected: number; suspended: number };
    matches: { total: number; contactUnlocked: number; conversations: number };
    interests: { total: number };
    reports: { open: number };
}

export interface MemberListResponse {
    data: MemberRow[];
    pagination: PaginationMeta;
}

export interface ProfileListResponse {
    data: LoveProfile[];
    pagination: PaginationMeta;
}

export interface ReportListResponse {
    data: Report[];
    pagination: PaginationMeta;
}

// --- Error handler ---

function handleError(error: unknown): string {
    if (axios.isAxiosError(error) && error.response?.data?.message) {
        return error.response.data.message;
    }
    if (error instanceof Error) return error.message;
    return 'Une erreur inattendue est survenue';
}

export { handleError };

// --- API functions ---

export async function listProfiles(params: {
    status?: ProfileStatus;
    page?: number;
    limit?: number;
}): Promise<ProfileListResponse> {
    try {
        const response = await apiClient.get('/sbclove/admin/profiles', { params });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return {
            data: response.data.data,
            pagination: response.data.pagination,
        };
    } catch (error) {
        throw new Error(handleError(error));
    }
}

/** The member directory. Server-side paginated — never fetch it all. */
export async function listMembers(params: {
    status?: ProfileStatus;
    page?: number;
    limit?: number;
}): Promise<MemberListResponse> {
    try {
        const response = await apiClient.get('/sbclove/admin/members', { params });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return { data: response.data.data, pagination: response.data.pagination };
    } catch (error) {
        throw new Error(handleError(error));
    }
}

/** Dashboard totals. Served from a 60s server-side cache. */
export async function getStats(): Promise<SbcLoveStats> {
    try {
        const response = await apiClient.get('/sbclove/admin/stats');
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function validateProfile(
    id: string,
    approve: boolean,
    rejectionReason?: string
): Promise<LoveProfile> {
    try {
        const response = await apiClient.patch(`/sbclove/admin/profiles/${id}/validate`, {
            approve,
            ...(rejectionReason ? { rejectionReason } : {}),
        });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function setSuspension(
    id: string,
    suspend: boolean
): Promise<LoveProfile> {
    try {
        const response = await apiClient.patch(`/sbclove/admin/profiles/${id}/suspension`, {
            suspend,
        });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function listReports(params: {
    status?: ReportStatus;
    page?: number;
    limit?: number;
}): Promise<ReportListResponse> {
    try {
        const response = await apiClient.get('/sbclove/admin/reports', { params });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return {
            data: response.data.data,
            pagination: response.data.pagination,
        };
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function reviewReport(
    id: string,
    status: ReportStatus.REVIEWED | ReportStatus.DISMISSED
): Promise<Report> {
    try {
        const response = await apiClient.patch(`/sbclove/admin/reports/${id}`, { status });
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function getModuleConfig(): Promise<ModuleConfig> {
    try {
        const response = await apiClient.get('/sbclove/admin/module');
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}

export async function updateModuleConfig(
    updates: Partial<Omit<ModuleConfig, '_id' | 'key' | 'updatedAt'>>
): Promise<ModuleConfig> {
    try {
        const response = await apiClient.patch('/sbclove/admin/module', updates);
        if (!response.data.success) throw new Error(response.data.message || 'Erreur');
        return response.data.data;
    } catch (error) {
        throw new Error(handleError(error));
    }
}
