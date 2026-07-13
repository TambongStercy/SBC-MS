import apiClient from '../api/apiClient';
import { AxiosError } from 'axios';

// --- Types (mirroring sbclove-service) ---

export type Intention =
    | 'relation_serieuse'
    | 'faire_connaissance'
    | 'projet_mariage'
    | 'elargir_cercle_social'
    | 'echange_valeurs_respect'
    | 'autre';

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export interface SbcloveProfilePhoto {
    fileId: string;
    blurredFileId?: string;
    order: number;
}

export interface SbcloveAdminProfile {
    _id: string;
    userId: string;
    displayName?: string;
    intention: Intention;
    otherIntentionText?: string;
    description: string;
    photos: SbcloveProfilePhoto[];
    status: ProfileStatus;
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

export interface SbcloveReport {
    _id: string;
    reporterId: string;
    reportedUserId: string;
    reportedProfileId: string;
    reason: string;
    status: ReportStatus;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
}

export interface SbcloveModuleConfig {
    enabled: boolean;
    activeWeekday: number;
    openHour: number;
    closeHour: number;
    timezone: string;
    maxInterestsPerWeek: number;
    autoSuspendThreshold: number;
    autoApprove: boolean;
    updatedBy?: string;
    updatedAt?: string;
}

export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
}

interface ListResponse<T> {
    success: boolean;
    data: T[];
    pagination?: PaginationMeta;
    message?: string;
}

interface ItemResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

const toError = (error: unknown, fallback: string): Error => {
    if (error instanceof AxiosError) {
        return new Error(error.response?.data?.message || error.message || fallback);
    }
    return new Error(fallback);
};

// --- Profiles (validation queue + suspension) ---

export const listSbcloveProfiles = async (params: {
    status?: ProfileStatus;
    page?: number;
    limit?: number;
} = {}): Promise<ListResponse<SbcloveAdminProfile>> => {
    try {
        const response = await apiClient.get<ListResponse<SbcloveAdminProfile>>('/sbclove/admin/profiles', { params });
        return response.data;
    } catch (error) {
        throw toError(error, 'Failed to load SBC Love profiles.');
    }
};

export const validateSbcloveProfile = async (
    profileId: string,
    approve: boolean,
    rejectionReason?: string
): Promise<SbcloveAdminProfile> => {
    try {
        const response = await apiClient.patch<ItemResponse<SbcloveAdminProfile>>(
            `/sbclove/admin/profiles/${profileId}/validate`,
            { approve, rejectionReason }
        );
        return response.data.data;
    } catch (error) {
        throw toError(error, 'Failed to validate profile.');
    }
};

export const setSbcloveProfileSuspension = async (
    profileId: string,
    suspend: boolean,
    reason?: string
): Promise<SbcloveAdminProfile> => {
    try {
        const response = await apiClient.patch<ItemResponse<SbcloveAdminProfile>>(
            `/sbclove/admin/profiles/${profileId}/suspension`,
            { suspend, reason }
        );
        return response.data.data;
    } catch (error) {
        throw toError(error, 'Failed to update suspension.');
    }
};

// --- Reports ---

export const listSbcloveReports = async (params: {
    status?: ReportStatus;
    page?: number;
    limit?: number;
} = {}): Promise<ListResponse<SbcloveReport>> => {
    try {
        const response = await apiClient.get<ListResponse<SbcloveReport>>('/sbclove/admin/reports', { params });
        return response.data;
    } catch (error) {
        throw toError(error, 'Failed to load reports.');
    }
};

export const reviewSbcloveReport = async (
    reportId: string,
    status: ReportStatus
): Promise<SbcloveReport> => {
    try {
        const response = await apiClient.patch<ItemResponse<SbcloveReport>>(
            `/sbclove/admin/reports/${reportId}`,
            { status }
        );
        return response.data.data;
    } catch (error) {
        throw toError(error, 'Failed to update report.');
    }
};

// --- Module config (kill-switch + window + thresholds) ---

export const getSbcloveModuleConfig = async (): Promise<SbcloveModuleConfig> => {
    try {
        const response = await apiClient.get<ItemResponse<SbcloveModuleConfig>>('/sbclove/admin/module');
        return response.data.data;
    } catch (error) {
        throw toError(error, 'Failed to load module configuration.');
    }
};

export const updateSbcloveModuleConfig = async (
    body: Partial<SbcloveModuleConfig>
): Promise<SbcloveModuleConfig> => {
    try {
        const response = await apiClient.patch<ItemResponse<SbcloveModuleConfig>>('/sbclove/admin/module', body);
        return response.data.data;
    } catch (error) {
        throw toError(error, 'Failed to update module configuration.');
    }
};

export const INTENTION_LABELS: Record<Intention, string> = {
    relation_serieuse: 'Relation sérieuse',
    faire_connaissance: 'Faire connaissance',
    projet_mariage: 'Projet de mariage',
    elargir_cercle_social: 'Élargir mon cercle social',
    echange_valeurs_respect: 'Échange basé sur les valeurs et le respect',
    autre: 'Autre intention',
};
