import apiClient from '../api/apiClient';

// Types
export interface RelanceButton {
    label: string;
    url: string;
    color?: string;
}

export interface RelanceMessage {
    _id?: string;
    dayNumber: number;
    subject?: string;
    messageTemplate: {
        fr: string;
        en: string;
    };
    mediaUrls: {
        url: string;
        type: 'image' | 'video' | 'pdf';
        filename?: string;
    }[];
    buttons: RelanceButton[];
    variables: string[];
    active: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface RelanceConfig {
    _id: string;
    userId: string;
    enabled: boolean;
    enrollmentPaused: boolean;
    sendingPaused: boolean;
    whatsappStatus: 'disconnected' | 'connecting' | 'connected' | 'failed';
    lastQrScanDate?: string;
    lastConnectionCheck?: string;
    messagesSentToday: number;
    lastResetDate: string;
}

export interface RelanceTarget {
    _id: string;
    referralUserId: string;
    referrerUserId: string;
    enteredLoopAt: string;
    currentDay: number;
    nextMessageDue: string;
    lastMessageSentAt?: string;
    messagesDelivered: {
        dayNumber: number;
        sentAt: string;
        messageText: string;
        success: boolean;
        errorMessage?: string;
    }[];
    exitedLoopAt?: string;
    exitReason?: 'paid' | 'completed_7_days' | 'subscription_expired' | 'manual';
    status: 'active' | 'completed' | 'failed';
    language: string;
}

export interface RelanceStats {
    totalActiveTargets: number;
    totalCompletedTargets: number;
    totalMessagesSent: number;
    totalSuccessRate: number;
    activeConfigsCount: number;
    targetsEnrolledToday: number;
    messagesSentToday: number;
    exitReasons: {
        paid: number;
        completed_7_days: number;
        subscription_expired: number;
        manual: number;
    };
}

export interface RelanceLog {
    _id: string;
    targetId: string;
    referralUserId: string;
    referrerUserId: string;
    dayNumber: number;
    messageText: string;
    success: boolean;
    errorMessage?: string;
    sentAt: string;
}

// API Functions

/**
 * Get all relance message templates (Day 1-7)
 */
export const getAllMessages = async (): Promise<RelanceMessage[]> => {
    const response = await apiClient.get('/relance/admin/messages');
    return response.data.data;
};

/**
 * Create or update a message template for a specific day
 */
export const upsertMessage = async (message: Omit<RelanceMessage, '_id' | 'createdAt' | 'updatedAt'>): Promise<RelanceMessage> => {
    const response = await apiClient.post('/relance/admin/messages', message);
    return response.data.data;
};

/**
 * Deactivate a message template for a specific day
 */
export const deactivateMessage = async (dayNumber: number): Promise<void> => {
    await apiClient.delete(`/relance/admin/messages/${dayNumber}`);
};

/**
 * Get relance statistics
 */
export const getStats = async (): Promise<RelanceStats> => {
    const response = await apiClient.get('/relance/admin/stats');
    return response.data.data;
};

/**
 * Get all active targets with pagination
 */
export const getActiveTargets = async (page: number = 1, limit: number = 20): Promise<{
    targets: RelanceTarget[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const response = await apiClient.get('/relance/admin/targets', {
        params: { page, limit, status: 'active' }
    });
    return response.data.data;
};

/**
 * Get delivery logs with pagination
 */
export const getDeliveryLogs = async (page: number = 1, limit: number = 50, filters?: {
    userId?: string;
    success?: boolean;
    dayNumber?: number;
    dateFrom?: string;
    dateTo?: string;
}): Promise<{
    logs: RelanceLog[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const response = await apiClient.get('/relance/admin/logs', {
        params: { page, limit, ...filters }
    });
    return response.data.data;
};

/**
 * Get all active relance configs
 */
export const getActiveConfigs = async (): Promise<RelanceConfig[]> => {
    const response = await apiClient.get('/relance/admin/configs');
    return response.data.data;
};

/**
 * Manually exit a user from relance loop
 */
export const exitUserFromLoop = async (userId: string): Promise<void> => {
    await apiClient.post('/relance/internal/exit-user', { userId });
};

/**
 * Upload media file for relance messages
 */
export const uploadMediaFile = async (file: File): Promise<{
    url: string;
    type: 'image' | 'video' | 'pdf';
    filename: string;
    originalName: string;
    size: number;
}> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post('/relance/admin/upload-media', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
    return response.data.data;
};

// ===== CAMPAIGN MANAGEMENT (Admin) =====

export interface Campaign {
    _id: string;
    userId: string;
    name: string;
    type: 'default' | 'filtered';
    status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
    targetFilter?: {
        countries?: string[];
        registrationDateFrom?: string;
        registrationDateTo?: string;
        gender?: 'male' | 'female' | 'other' | 'all';
        professions?: string[];
        minAge?: number;
        maxAge?: number;
        excludeCurrentTargets?: boolean;
    };
    estimatedTargetCount?: number;
    actualTargetCount?: number;
    scheduledStartDate?: string;
    runAfterCampaignId?: string;
    priority?: number;
    customMessages?: Array<{
        dayNumber: number;
        subject?: string;
        messageTemplate: {
            fr: string;
            en: string;
        };
        mediaUrls?: {
            url: string;
            type: 'image' | 'video' | 'pdf';
            filename?: string;
        }[];
        buttons?: RelanceButton[];
    }>;
    targetsEnrolled: number;
    messagesSent: number;
    messagesDelivered: number;
    messagesFailed: number;
    targetsCompleted: number;
    targetsExited: number;
    maxMessagesPerDay?: number;
    messagesSentToday?: number;
    startedAt?: string;
    actualEndDate?: string;
    cancellationReason?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CampaignTarget {
    _id: string;
    referralUserId: string;
    referrerUserId: string;
    campaignId: string;
    enteredLoopAt: string;
    currentDay: number;
    nextMessageDue: string;
    lastMessageSentAt?: string;
    messagesDelivered: {
        day: number;
        sentAt: string;
        status: 'delivered' | 'failed';
        errorMessage?: string;
    }[];
    exitedLoopAt?: string;
    exitReason?: 'paid' | 'completed_7days' | 'manual' | 'referrer_inactive';
    status: 'active' | 'completed' | 'paused';
    language: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Get all campaigns (admin view - all users)
 */
export const getAllCampaigns = async (filters?: {
    userId?: string;
    type?: 'default' | 'filtered';
    status?: string;
    page?: number;
    limit?: number;
}): Promise<{
    campaigns: Campaign[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const response = await apiClient.get('/relance/admin/campaigns', {
        params: filters
    });
    return response.data.data;
};

/**
 * Get campaign by ID (admin)
 */
export const getCampaignById = async (campaignId: string): Promise<Campaign> => {
    const response = await apiClient.get(`/relance/admin/campaigns/${campaignId}`);
    return response.data.data;
};

/**
 * Get campaign targets (admin)
 */
export const getCampaignTargets = async (
    campaignId: string,
    page: number = 1,
    limit: number = 20
): Promise<{
    targets: CampaignTarget[];
    total: number;
    page: number;
    totalPages: number;
}> => {
    const response = await apiClient.get(`/relance/admin/campaigns/${campaignId}/targets`, {
        params: { page, limit }
    });
    return response.data.data;
};

/**
 * Pause campaign (admin)
 */
export const pauseCampaign = async (campaignId: string, userId: string): Promise<Campaign> => {
    const response = await apiClient.post(`/relance/admin/campaigns/${campaignId}/pause`, { userId });
    return response.data.data;
};

/**
 * Resume campaign (admin)
 */
export const resumeCampaign = async (campaignId: string, userId: string): Promise<Campaign> => {
    const response = await apiClient.post(`/relance/admin/campaigns/${campaignId}/resume`, { userId });
    return response.data.data;
};

/**
 * Cancel campaign (admin)
 */
export const cancelCampaign = async (
    campaignId: string,
    userId: string,
    reason?: string
): Promise<Campaign> => {
    const response = await apiClient.post(`/relance/admin/campaigns/${campaignId}/cancel`, {
        userId,
        reason
    });
    return response.data.data;
};

/**
 * Get campaign statistics
 */
export const getCampaignStats = async (): Promise<{
    totalCampaigns: number;
    activeCampaigns: number;
    completedCampaigns: number;
    totalTargetsEnrolled: number;
    totalMessagesSent: number;
    averageSuccessRate: number;
}> => {
    const response = await apiClient.get('/relance/admin/campaigns/stats');
    return response.data.data;
};

/**
 * Get stats for a specific campaign
 */
export const getCampaignStatsById = async (campaignId: string): Promise<{
    campaign: {
        _id: string;
        name: string;
        status: string;
        type: string;
        actualStartDate?: string;
        actualEndDate?: string;
    };
    totalEnrolled: number;
    activeTargets: number;
    completedRelance: number;
    totalMessagesSent: number;
    totalMessagesDelivered: number;
    totalMessagesFailed: number;
    deliveryPercentage: number;
    dayProgression: { day: number; count: number }[];
    exitReasons: Record<string, number>;
}> => {
    const response = await apiClient.get(`/relance/admin/campaigns/${campaignId}/stats`);
    return response.data.data;
};

/**
 * Get recent messages for a specific campaign
 */
export const getCampaignRecentMessages = async (campaignId: string, limit: number = 10): Promise<{
    campaignName: string | null;
    messages: RecentMessage[];
    total: number;
}> => {
    const response = await apiClient.get(`/relance/admin/campaigns/${campaignId}/messages/recent`, {
        params: { limit }
    });
    return response.data.data;
};

export interface RecentMessage {
    day: number;
    sentAt: string;
    status: 'delivered' | 'failed';
    errorMessage?: string;
    referralUser: {
        _id: string;
        name: string;
        email: string;
        phoneNumber?: string;
        avatar?: string;
    } | null;
    campaignId?: string | null;
    campaignName?: string | null;
    renderedHtml?: string | null;
}

/**
 * Preview a relance email template
 */
export const previewMessage = async (data: {
    dayNumber: number;
    subject?: string;
    messageTemplate?: { fr: string; en: string };
    mediaUrls?: { url: string; type: 'image' | 'video' | 'pdf' }[];
    buttons?: RelanceButton[];
    recipientName?: string;
    referrerName?: string;
}): Promise<string> => {
    const response = await apiClient.post('/relance/admin/messages/preview', data);
    return response.data.data.html;
};