import { UserSex } from '../database/models/user.model';

// Re-export UserSex enum for use in controllers
export { UserSex };

/**
 * Interface for contact search filters
 */
export interface ContactSearchFilters {
    // Filters based on user profile data
    country?: string; // Filters the new `country` field
    region?: string; // Filters the existing `region` field
    city?: string; // Added city filter
    sex?: UserSex;
    minAge?: number;
    maxAge?: number;
    language?: string; // Added language filter (assuming single string for now)
    profession?: string; // Added profession filter
    interests?: string[]; // Added interests filter (array)
    // 'interest' singular was used in controller, let's keep 'interests' as array here.

    // Filters based on other criteria (if needed, TBD)
    // registrationDateStart?: Date;
    // registrationDateEnd?: Date;
    // preferenceCategories?: string[]; // Removed, redundant with interests

    // Special filter flag (added by controller/service logic)
    requireActiveSubscription?: boolean;

    // Pagination
    page?: number;
    limit?: number;
}

/**
 * Interface for contact search response
 */
export interface ContactSearchResponse {
    users: Array<{
        _id: string;
        name: string;
        email: string; // Consider omitting if shareContactInfo is false
        phoneNumber?: number; // Optional, consider omitting if shareContactInfo is false
        region?: string;
        city?: string; // Add city
        sex?: UserSex;
        birthDate?: Date; // Use birthDate to calculate age if needed
        language?: string[]; // Keep as array? Let's make filter single, but response array
        profession?: string;
        interests?: string[];
        createdAt: Date;
        // Add shareContactInfo if needed
    }>;
    totalCount: number;
    page: number;
    totalPages: number;
} 