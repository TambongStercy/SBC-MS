import apiClient from './apiClient';

// Types for Cloud Storage monitoring API responses
export interface StorageUsage {
    used: number;           // Bytes used
    total: number;          // Unlimited for Cloud Storage (-1)
    percentage: number;     // Percentage based on cost thresholds
    availableSpace: number; // Unlimited for Cloud Storage (-1)
    fileCount: number;      // Number of files
}

export interface StorageCosts {
    storage: number;        // Monthly storage cost in FCFA
    bandwidth: number;      // Monthly bandwidth cost in FCFA
    operations: number;     // Monthly operations cost in FCFA
    total: number;          // Total monthly cost in FCFA
}

export interface StorageBreakdown {
    totalFiles: number;
    profilePictureFiles: number;
    productFiles: number;
    documentFiles: number;
    otherFiles: number;
    breakdown: string[];
    costs: StorageCosts;
}

export interface StorageAlert {
    level: 'info' | 'warning' | 'critical';
    costThreshold: number;  // Cost threshold in FCFA
    message: string;
    recommendedActions: string[];
}

export interface CleanupCandidates {
    count: number;
    potentialSavings: string; // Formatted cost savings
    note: string;
}

export interface StorageStatusResponse {
    success: boolean;
    data: {
        usage: {
            used: string;           // Formatted size (e.g., "125.5 MB")
            total: string;          // "Unlimited" for Cloud Storage
            available: string;      // "Unlimited" for Cloud Storage  
            percentage: string;     // Cost-based percentage (e.g., "25.3%")
            raw: StorageUsage;
        };
        costs: {
            storage: string;        // Formatted storage cost
            bandwidth: string;      // Formatted bandwidth cost
            operations: string;     // Formatted operations cost
            total: string;          // Formatted total monthly cost
            raw: StorageCosts;
        };
        breakdown: StorageBreakdown | null;
        alert: StorageAlert | null;
        cleanupCandidates: CleanupCandidates;
        recommendations: string[];
        healthStatus: 'HEALTHY' | 'MODERATE' | 'WARNING' | 'CRITICAL';
        protectionPolicy: {
            profilePictures: string;    // "PROTECTED"
            productImages: string;      // "PROTECTED"
            userGeneratedContent: string; // "PROTECTED"
            temporaryFiles: string;     // "CLEANABLE"
        };
    };
}

export interface CleanupCandidatesResponse {
    success: boolean;
    data: {
        totalFiles: number;
        totalSizeToFree: string;    // Formatted size
        daysOld: number;
        estimatedCostSavings: string; // Estimated monthly cost savings
        candidates: {
            id: string;
            name: string;
            createdTime: string;
            size: string;
            mimeType: string;
        }[];
    };
}

export interface StorageCheckResponse {
    success: boolean;
    message: string;
    data: {
        usage: {
            used: string;
            fileCount: string;
            totalCost: string;      // Monthly cost in FCFA
        };
        alert: StorageAlert | null;
        timestamp: string;
    };
}

// API functions for Cloud Storage monitoring
export const getStorageStatus = async (): Promise<StorageStatusResponse> => {
    const response = await apiClient.get('/settings/storage/status');
    return response.data;
};

export const runStorageCheck = async (): Promise<StorageCheckResponse> => {
    const response = await apiClient.post('/settings/storage/check');
    return response.data;
};

export const getCleanupCandidates = async (daysOld: number = 7): Promise<CleanupCandidatesResponse> => {
    const response = await apiClient.get(`/settings/storage/cleanup-candidates?daysOld=${daysOld}`);
    return response.data;
}; 