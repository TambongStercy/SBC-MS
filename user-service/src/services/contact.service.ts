import { IUser } from '../database/models/user.model';
import { UserRepository } from '../database/repositories/user.repository';
import { ContactSearchFilters, ContactSearchResponse, SubscriptionType } from '../types/contact.types';
import { generateVCFFile } from '../utils/vcf.utils';
import { SubscriptionService } from './subscription.service';

export class ContactService {
    private userRepository: UserRepository;
    private subscriptionService: SubscriptionService;

    constructor() {
        this.userRepository = new UserRepository();
        this.subscriptionService = new SubscriptionService();
    }

    /**
     * Check if a user has access to specific contact features
     * @param userId The user ID to check subscriptions for
     * @param requiredSubscription The subscription type required
     * @returns Boolean indicating if the user has the required subscription
     */
    private async hasSubscriptionAccess(userId: string, requiredSubscription: SubscriptionType): Promise<boolean> {
        // Basic platform access check
        if (requiredSubscription === SubscriptionType.PLATFORM_ACCESS) {
            return await this.subscriptionService.hasActiveSubscription(userId);
        }

        // Advanced contact plan check
        if (requiredSubscription === SubscriptionType.CONTACT_PLAN) {
            return await this.subscriptionService.hasContactPlanSubscription(userId);
        }

        return false;
    }

    /**
     * Validate contact search filters based on user's subscription
     * @param userId The user ID performing the search
     * @param filters The filter parameters to validate
     * @throws Error if the user doesn't have access to certain filters
     */
    private async validateFilters(userId: string, filters: ContactSearchFilters): Promise<void> {
        const hasBasicAccess = await this.hasSubscriptionAccess(userId, SubscriptionType.PLATFORM_ACCESS);

        if (!hasBasicAccess) {
            throw new Error('You need an active subscription to access contacts');
        }

        // Check if advanced filters are being used
        const usingAdvancedFilters =
            filters.sex !== undefined ||
            filters.minAge !== undefined ||
            filters.maxAge !== undefined ||
            (filters.preferenceCategories && filters.preferenceCategories.length > 0) ||
            filters.region !== undefined;

        if (usingAdvancedFilters) {
            const hasContactPlan = await this.hasSubscriptionAccess(userId, SubscriptionType.CONTACT_PLAN);

            if (!hasContactPlan) {
                throw new Error('Advanced filtering requires a contact plan subscription');
            }
        }
    }

    /**
     * Search for contacts based on specified filters
     * @param userId The user ID performing the search
     * @param filters The search filter parameters
     * @returns Filtered contact data and pagination info
     */
    async searchContacts(userId: string, filters: ContactSearchFilters): Promise<ContactSearchResponse> {
        await this.validateFilters(userId, filters);
        return await this.userRepository.searchContactUsers(userId, filters);
    }

    /**
     * Generate a VCF file from contacts matching the specified filters
     * @param userId The user ID requesting the export
     * @param filters The search filter parameters
     * @returns Buffer containing VCF file data
     */
    async exportContactsAsVCF(userId: string, filters: ContactSearchFilters): Promise<Buffer> {
        await this.validateFilters(userId, filters);

        // Remove pagination for export to get all matching contacts
        const fullFilters = { ...filters, page: undefined, limit: undefined };
        const { users } = await this.userRepository.searchContactUsers(userId, fullFilters);

        return generateVCFFile(users);
    }
} 