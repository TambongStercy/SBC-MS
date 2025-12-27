import apiClient from '../api/apiClient'; // Assuming shared Axios instance with base URL and auth handling

// Define interfaces matching the backend models/responses
interface IFileReference {
    fileId: string;
    url?: string;        // Dynamically generated proxy URL
    fileName?: string;
    mimeType?: string;
    size?: number;
}

export interface IFormation {
    _id: string; // Mongoose adds _id to subdocuments
    title: string;
    link: string;
}

export interface ISettings {
    _id?: string; // Assuming _id might exist
    whatsappGroupUrl?: string;
    telegramGroupUrl?: string;
    discordGroupUrl?: string;
    companyLogo?: IFileReference;
    termsAndConditionsPdf?: IFileReference;
    presentationVideo?: IFileReference;
    presentationPdf?: IFileReference;
    formations: IFormation[]; // Array of formation objects
    events: IEvent[]; // Assuming IEvent is defined elsewhere or will be
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEvent {
    _id: string;
    title: string;
    description: string;
    image?: IFileReference; // Make image optional for updates
    video?: IFileReference; // Make video optional for updates
    timestamp?: Date;
    createdAt: Date;
    updatedAt: Date;
}

interface PaginatedEventsResponse {
    events: IEvent[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
    limit: number;
}

// Add this interface definition
interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

// --- API Response Types ---
type SettingsResponse = { success: boolean; data: ISettings | null; message?: string };
type EventResponse = { success: boolean; data: IEvent; message?: string };
type EventListResponse = { success: boolean; data: PaginatedEventsResponse };
type GenericSuccessResponse = { success: boolean; message?: string; data?: any };

// --- API Service --- 

const SETTINGS_API_URL = '/settings'; // Base path for settings service in API gateway/proxy
const EVENTS_API_URL = '/events';     // Base path for events endpoint in settings service

// Fetch current settings
export const getSettings = async (): Promise<ISettings | null> => {
    try {
        const response = await apiClient.get<SettingsResponse>(`${SETTINGS_API_URL}/`);
        return response.data.data; // Assuming data is nested { success: true, data: {...} }
    } catch (error) {
        console.error('API Error getting settings:', error);
        // Rethrow or handle error appropriately for UI
        throw error;
    }
};

// Update non-file settings
export const updateSettings = async (settingsData: Partial<Pick<ISettings, 'whatsappGroupUrl' | 'telegramGroupUrl' | 'discordGroupUrl'>>): Promise<ISettings> => {
    try {
        const response = await apiClient.put<SettingsResponse>(`${SETTINGS_API_URL}/`, settingsData);
        if (!response.data.data) throw new Error('No settings data returned after update.');
        return response.data.data;
    } catch (error) {
        console.error('API Error updating settings:', error);
        throw error;
    }
};

// Helper for file uploads
const uploadFile = async (endpoint: string, fieldName: string, file: File): Promise<ISettings> => {
    const formData = new FormData();
    formData.append(fieldName, file);

    try {
        const response = await apiClient.post<SettingsResponse>(endpoint, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        if (!response.data.data) throw new Error('No settings data returned after file upload.');
        return response.data.data;
    } catch (error) {
        console.error(`API Error uploading file to ${endpoint}:`, error);
        throw error;
    }
};

// Specific file upload functions
export const uploadCompanyLogo = async (file: File): Promise<ISettings> => {
    return uploadFile(`${SETTINGS_API_URL}/logo`, 'companyLogo', file);
};

export const uploadTermsPdf = async (file: File): Promise<ISettings> => {
    return uploadFile(`${SETTINGS_API_URL}/terms-pdf`, 'termsPdf', file);
};

export const uploadPresentationVideo = async (file: File): Promise<ISettings> => {
    return uploadFile(`${SETTINGS_API_URL}/presentation-video`, 'presentationVideo', file);
};

export const uploadPresentationPdf = async (file: File): Promise<ISettings> => {
    return uploadFile(`${SETTINGS_API_URL}/presentation-pdf`, 'presentationPdf', file);
};

// --- Events API --- 

// Fetch events (paginated)
export const getEvents = async (params: { limit?: number; page?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {}): Promise<PaginatedEventsResponse> => {
    try {
        const response = await apiClient.get<EventListResponse>(`${EVENTS_API_URL}/`, { params });
        return response.data.data;
    } catch (error) {
        console.error('API Error getting events:', error);
        throw error;
    }
};

// Create a new event
export const createEvent = async (eventData: {
    title: string;
    description: string;
    timestamp?: string | Date;
    imageFile: File;
    videoFile?: File;
}): Promise<IEvent> => {
    const formData = new FormData();
    formData.append('title', eventData.title);
    formData.append('description', eventData.description);
    if (eventData.timestamp) {
        const timestampString = (eventData.timestamp instanceof Date)
            ? eventData.timestamp.toISOString()
            : eventData.timestamp;
        formData.append('timestamp', timestampString);
    }
    formData.append('imageFile', eventData.imageFile);
    if (eventData.videoFile) {
        formData.append('videoFile', eventData.videoFile);
    }

    try {
        const response = await apiClient.post<EventResponse>(`${EVENTS_API_URL}/`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data.data;
    } catch (error) {
        console.error('API Error creating event:', error);
        throw error;
    }
};

// Update an existing event
export const updateEvent = async (eventId: string, eventData: {
    title?: string; // All fields are optional for update
    description?: string;
    timestamp?: string | Date;
    imageFile?: File;
    videoFile?: File | null; // Allow null to indicate removal?
}): Promise<IEvent> => {
    const formData = new FormData();
    // Append fields only if they are provided
    if (eventData.title !== undefined) formData.append('title', eventData.title);
    if (eventData.description !== undefined) formData.append('description', eventData.description);
    if (eventData.timestamp !== undefined) {
        const timestampString = (eventData.timestamp instanceof Date)
            ? eventData.timestamp.toISOString()
            : eventData.timestamp;
        formData.append('timestamp', timestampString);
    }
    if (eventData.imageFile) {
        formData.append('imageFile', eventData.imageFile);
    }
    if (eventData.videoFile) { // If a new file is provided
        formData.append('videoFile', eventData.videoFile);
    }
    // TODO: How does the backend know to *remove* the video if videoFile is undefined/null here?
    // The backend currently only handles replacement. Explicit removal might need a flag.
    // else if (eventData.videoFile === null) { 
    //     formData.append('removeVideo', 'true'); // Example flag
    // }

    try {
        const response = await apiClient.put<EventResponse>(`${EVENTS_API_URL}/${eventId}`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data.data;
    } catch (error) {
        console.error(`API Error updating event ${eventId}:`, error);
        throw error;
    }
};

// Delete an event
export const deleteEvent = async (eventId: string): Promise<void> => {
    try {
        await apiClient.delete<GenericSuccessResponse>(`${EVENTS_API_URL}/${eventId}`);
    } catch (error) {
        console.error(`API Error deleting event ${eventId}:`, error);
        throw error;
    }
};

// --- NEW: Formation Management API Calls ---

export const getFormations = async (): Promise<IFormation[]> => {
    try {
        const response = await apiClient.get<ApiResponse<IFormation[]>>('/settings/formations');
        return response.data.success ? response.data.data : [];
    } catch (error) {
        console.error('API Error fetching formations:', error);
        throw error;
    }
};

export const addFormation = async (formationData: { title: string; link: string }): Promise<IFormation> => {
    try {
        const response = await apiClient.post<ApiResponse<IFormation>>('/settings/formations', formationData);
        return response.data.data;
    } catch (error) {
        console.error('API Error adding formation:', error);
        throw error;
    }
};

export const updateFormation = async (formationId: string, formationData: Partial<Omit<IFormation, '_id'>>): Promise<IFormation> => {
    try {
        const response = await apiClient.put<ApiResponse<IFormation>>(`/settings/formations/${formationId}`, formationData);
        return response.data.data;
    } catch (error) {
        console.error(`API Error updating formation ${formationId}:`, error);
        throw error;
    }
};

export const removeFormation = async (formationId: string): Promise<void> => {
    try {
        await apiClient.delete(`/settings/formations/${formationId}`);
    } catch (error) {
        console.error(`API Error removing formation ${formationId}:`, error);
        throw error;
    }
};

// --- Gateway Balance API ---

export interface IGatewayBalances {
    nowpaymentsBalanceUSD: number;
    feexpayBalanceXAF: number;
    cinetpayBalanceXAF: number;
    totalExternalBalanceXAF: number;
    lastUpdatedBy?: string;
    lastUpdatedAt?: string;
    notes?: string;
}

export interface IGatewayBalanceInput {
    nowpaymentsBalanceUSD: number;
    feexpayBalanceXAF: number;
    cinetpayBalanceXAF: number;
    notes?: string;
}

export interface IAppRevenueData {
    externalBalances: IGatewayBalances;
    userLiabilities: {
        totalUserBalanceXAF: number;
        totalUserBalanceUSD: number;
        totalLiabilitiesXAF: number;
    };
    appRevenue: {
        revenueXAF: number;
        revenueUSD: number;
    };
}

// Get current gateway balances
export const getGatewayBalances = async (): Promise<IGatewayBalances> => {
    try {
        const response = await apiClient.get<ApiResponse<IGatewayBalances>>(`${SETTINGS_API_URL}/gateway-balances`);
        return response.data.data;
    } catch (error) {
        console.error('API Error getting gateway balances:', error);
        throw error;
    }
};

// Update gateway balances
export const updateGatewayBalances = async (balances: IGatewayBalanceInput): Promise<IGatewayBalances> => {
    try {
        const response = await apiClient.put<ApiResponse<IGatewayBalances>>(`${SETTINGS_API_URL}/gateway-balances`, balances);
        return response.data.data;
    } catch (error) {
        console.error('API Error updating gateway balances:', error);
        throw error;
    }
};

// Calculate app revenue
export const calculateAppRevenue = async (totalUserBalanceXAF: number, totalUserBalanceUSD: number): Promise<IAppRevenueData> => {
    try {
        const response = await apiClient.post<ApiResponse<IAppRevenueData>>(`${SETTINGS_API_URL}/gateway-balances/calculate-revenue`, {
            totalUserBalanceXAF,
            totalUserBalanceUSD
        });
        return response.data.data;
    } catch (error) {
        console.error('API Error calculating app revenue:', error);
        throw error;
    }
};

// --- Live Gateway Balances API ---

export interface INowpaymentsBalance {
    currency: string;
    amount: number;
    pendingAmount: number;
    usdValue: number;
}

export interface ILiveGatewayBalances {
    nowpayments: {
        available: boolean;
        totalUsd: number;
        totalPendingUsd: number;
        balances: INowpaymentsBalance[];
        error?: string;
    };
    cinetpay: {
        available: boolean;
        total: number;
        available_balance: number;
        inUse: number;
        currency: string;
        error?: string;
    };
    feexpay: {
        available: boolean;
        message: string;
    };
    timestamp: string;
}

// Get live gateway balances from payment providers (real-time API calls)
export const getLiveGatewayBalances = async (): Promise<ILiveGatewayBalances> => {
    try {
        const response = await apiClient.get<ApiResponse<ILiveGatewayBalances>>('/payments/admin/gateway-balances/live');
        return response.data.data;
    } catch (error) {
        console.error('API Error fetching live gateway balances:', error);
        throw error;
    }
}; 