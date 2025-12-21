import apiClient from '../api/apiClient';

// Interfaces
export interface StatusCategory {
    key: string;
    name: string;
    nameFr: string;
    nameEn: string;
    badge: string;
    badgeColor: string;
    icon: string;
    adminOnly: boolean;
    description: string;
}

export interface StatusAuthor {
    _id: string;
    name: string;
    avatar?: string;
}

export interface StatusCategoryInfo {
    name: string;
    badge: string;
    badgeColor: string;
    icon: string;
}

export interface Status {
    _id: string;
    authorId: string;
    author?: StatusAuthor;
    category: string;
    categoryInfo?: StatusCategoryInfo;
    content: string;
    mediaType: 'text' | 'image' | 'video' | 'flyer';
    mediaUrl?: string;
    mediaThumbnailUrl?: string;
    videoDuration?: number;
    country?: string;
    city?: string;
    region?: string;
    likesCount: number;
    repostsCount: number;
    repliesCount: number;
    viewsCount: number;
    isLiked?: boolean;
    isReposted?: boolean;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface StatusFilters {
    category?: string;
    country?: string;
    city?: string;
    search?: string;
    sortBy?: 'recent' | 'popular';
}

export interface PaginationInfo {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
}

// API Functions

/**
 * Get status categories
 */
export const getCategories = async (): Promise<StatusCategory[]> => {
    const response = await apiClient.get('/chat/statuses/categories');
    return response.data.data;
};

/**
 * Get status feed with filters
 */
export const getStatusFeed = async (
    filters: StatusFilters = {},
    page: number = 1,
    limit: number = 20
): Promise<{ data: Status[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get('/chat/statuses', {
        params: { ...filters, page, limit }
    });
    return response.data;
};

/**
 * Get single status
 */
export const getStatus = async (statusId: string): Promise<Status> => {
    const response = await apiClient.get(`/chat/statuses/${statusId}`);
    return response.data.data;
};

/**
 * Get user's statuses
 */
export const getUserStatuses = async (
    userId: string,
    page: number = 1,
    limit: number = 20
): Promise<{ data: Status[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get(`/chat/statuses/user/${userId}`, {
        params: { page, limit }
    });
    return response.data;
};

/**
 * Create a new status
 */
export const createStatus = async (data: {
    category: string;
    content: string;
    country?: string;
    city?: string;
    region?: string;
    media?: File;
    videoDuration?: number;
}): Promise<Status> => {
    const formData = new FormData();
    formData.append('category', data.category);
    formData.append('content', data.content);

    if (data.country) formData.append('country', data.country);
    if (data.city) formData.append('city', data.city);
    if (data.region) formData.append('region', data.region);
    if (data.videoDuration) formData.append('videoDuration', data.videoDuration.toString());
    if (data.media) formData.append('media', data.media);

    const response = await apiClient.post('/chat/statuses', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data.data;
};

/**
 * Delete a status
 */
export const deleteStatus = async (statusId: string): Promise<void> => {
    await apiClient.delete(`/chat/statuses/${statusId}`);
};

/**
 * Like a status
 */
export const likeStatus = async (statusId: string): Promise<{ likesCount: number }> => {
    const response = await apiClient.post(`/chat/statuses/${statusId}/like`);
    return response.data.data;
};

/**
 * Unlike a status
 */
export const unlikeStatus = async (statusId: string): Promise<{ likesCount: number }> => {
    const response = await apiClient.delete(`/chat/statuses/${statusId}/like`);
    return response.data.data;
};

/**
 * Repost a status
 */
export const repostStatus = async (statusId: string): Promise<{ repostsCount: number }> => {
    const response = await apiClient.post(`/chat/statuses/${statusId}/repost`);
    return response.data.data;
};

/**
 * Reply to a status (creates conversation)
 */
export const replyToStatus = async (statusId: string): Promise<{ conversationId: string }> => {
    const response = await apiClient.post(`/chat/statuses/${statusId}/reply`);
    return response.data.data;
};

/**
 * Get interactions (likes/reposts)
 */
export const getStatusInteractions = async (
    statusId: string,
    type: 'likes' | 'reposts' = 'likes',
    page: number = 1,
    limit: number = 50
): Promise<{ data: any[]; pagination: PaginationInfo }> => {
    const response = await apiClient.get(`/chat/statuses/${statusId}/interactions`, {
        params: { type, page, limit }
    });
    return response.data;
};
