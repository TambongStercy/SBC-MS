import { IUser } from '../database/models/user.model';
import { UserRepository } from '../database/repositories/user.repository';
import { ContactSearchFilters, ContactSearchResponse } from '../types/contact.types';
import { SubscriptionType } from '../database/models/subscription.model';
import { generateVCFFile } from '../utils/vcf.utils';
import { SubscriptionService } from './subscription.service';
import { UserService } from './user.service';

export class ContactService {
    private userRepository: UserRepository;
    private subscriptionService: SubscriptionService;
    private userService: UserService;

    constructor() {
        this.userRepository = new UserRepository();
        this.subscriptionService = new SubscriptionService();
        this.userService = new UserService();
    }

    /**
     * Check if a user has access to specific contact features
     * @param userId The user ID to check subscriptions for
     * @param requiredSubscription The subscription type required
     * @returns Boolean indicating if the user has the required subscription
     */
    private async hasSubscriptionAccess(userId: string, requiredSubscription: SubscriptionType): Promise<boolean> {
        // Basic platform access check - Assuming CLASSIQUE is platform access
        if (requiredSubscription === SubscriptionType.CLASSIQUE) {
            return await this.subscriptionService.hasActiveSubscription(userId);
        }

        // Advanced contact plan check - Assuming CIBLE is contact plan
        if (requiredSubscription === SubscriptionType.CIBLE) {
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
        const hasBasicAccess = await this.hasSubscriptionAccess(userId, SubscriptionType.CLASSIQUE);

        if (!hasBasicAccess) {
            throw new Error('You need an active subscription to access contacts');
        }

        // Check if advanced filters are being used
        const usingAdvancedFilters =
            filters.sex !== undefined ||
            filters.minAge !== undefined ||
            filters.maxAge !== undefined ||
            (filters.preferenceCategories && filters.preferenceCategories.length > 0) ||
            (filters.professions && filters.professions.length > 0) ||
            filters.profession !== undefined ||
            (filters.interests && filters.interests.length > 0) ||
            filters.language !== undefined ||
            filters.region !== undefined ||
            filters.city !== undefined;

        if (usingAdvancedFilters) {
            const hasContactPlan = await this.hasSubscriptionAccess(userId, SubscriptionType.CIBLE);

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

        // Set default pagination
        const pagination = {
            page: filters.page || 1,
            limit: filters.limit || 10
        };

        // Use the user service method that supports professions array and better filtering
        const result = await this.userService.findUsersByCriteria(filters, pagination, true);

        // Convert the result to ContactSearchResponse format
        return {
            users: result.users.map(user => ({
                _id: user._id?.toString() || '',
                name: user.name || '',
                email: user.email || '',
                phoneNumber: user.phoneNumber,
                region: user.region,
                city: user.city,
                sex: user.sex,
                birthDate: user.birthDate,
                language: user.language,
                profession: user.profession,
                interests: user.interests,
                createdAt: user.createdAt || new Date()
            })),
            totalCount: result.totalCount,
            page: result.page,
            totalPages: result.totalPages
        };
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
        const users = await this.userService.findAllUsersByCriteria(fullFilters, true);

        return generateVCFFile(users);
    }
} 