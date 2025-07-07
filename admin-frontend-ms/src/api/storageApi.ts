import apiClient from './apiClient';

// Types for storage monitoring API responses
export interface StorageUsage {
    used: number;
    total: number;
    percentage: number;
    availableSpace: number;
}

export interface StorageBreakdown {
    totalFiles: number;
    userContent: {
        profilePictures: number;
        productImages: number;
        note: string;
    };
    otherFiles: number;
    summary: string[];
}

export interface StorageAlert {
    level: 'warning' | 'critical' | 'emergency';
    percentage: number;
    message: string;
    recommendedActions: string[];
}

export interface CleanupCandidates {
    count: number;
    note: string;
}

export interface StorageStatusResponse {
    success: boolean;
    data: {
        usage: {
            used: string;
            total: string;
            available: string;
            percentage: string;
            raw: StorageUsage;
        };
        breakdown: StorageBreakdown | null;
        alert: StorageAlert | null;
        cleanupCandidates: CleanupCandidates;
        recommendations: string[];
        healthStatus: 'HEALTHY' | 'MODERATE' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
        protectionPolicy: {
            profilePictures: string;
            productImages: string;
            userGeneratedContent: string;
            temporaryFiles: string;
        };
    };
}

export interface CleanupFile {
    id: string;
    name: string;
    size: string;
    createdTime: string;
    mimeType: string;
}

export interface CleanupCandidatesResponse {
    success: boolean;
    data: {
        totalFiles: number;
        totalSizeToFree: string;
        daysOld: number;
        files: CleanupFile[];
    };
}

export interface StorageCheckResponse {
    success: boolean;
    message: string;
    data: {
        usage: {
            used: string;
            total: string;
            percentage: string;
        };
        alert: StorageAlert | null;
        timestamp: string;
    };
}

// API functions
export const getStorageStatus = async (): Promise<StorageStatusResponse> => {
    const response = await apiClient.get('/settings/storage/status');
    return response.data;
};

export const runStorageCheck = async (): Promise<StorageCheckResponse> => {
    const response = await apiClient.post('/settings/storage/check');
    return response.data;
};

export const getCleanupCandidates = async (daysOld = 7): Promise<CleanupCandidatesResponse> => {
    const response = await apiClient.get(`/settings/storage/cleanup-candidates?daysOld=${daysOld}`);
    return response.data;
}; 