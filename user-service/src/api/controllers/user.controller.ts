import { Request, Response } from 'express';
import { userService } from '../../services/user.service';
import logger from '../../utils/logger';
import { subscriptionService } from '../../services/subscription.service';
import { SubscriptionType } from '../../database/models/subscription.model';
import { IUser } from '../../database/models/user.model';
import { PaginationOptions } from '../../types/express';
import { ContactSearchFilters, UserSex } from '../../types/contact.types';
import { isValidObjectId, Types } from 'mongoose';
import { NextFunction, Request as ExpressRequest } from 'express';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('UserController');

// Explicitly type AuthenticatedRequest if global augmentation is unreliable
// Align with typical JWT payload structure expected by middleware
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string; // Usually string representation of ObjectId
        email: string;
        role: string;
        id?: string; // Often JWT `sub` or a separate `id` field, usually string
    };
}

// Define structure for targeting criteria (match advertising-service)
interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other';
    interests?: string[];
    professions?: string[];
    language?: string[];
    city?: string[];
}

export class UserController {
    private log = logger.getLogger('UserController');
    // Inject SubscriptionService - assumes singleton export
    private subscriptionService = subscriptionService;



    /**
     * Get user balance
     * @route GET /api/users/:userId/balance
     */
    async getUserBalance(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.userId;

            // Verify the user exists
            const user = await userService.getUserProfile(userId);
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            res.status(200).json({
                success: true,
                balance: user.balance
            });
        } catch (error: any) {
            log.error(`Error getting user balance: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Error retrieving user balance'
            });
        }
    }

    /**
     * Update user balance
     * @route POST /api/users/:userId/balance
     */
    async updateUserBalance(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.userId;
            const { amount } = req.body;

            // Validate input
            if (amount === undefined || isNaN(Number(amount))) {
                res.status(400).json({
                    success: false,
                    message: 'Valid amount is required'
                });
                return;
            }

            const numericAmount = Number(amount);

            // Update balance
            const newBalance = await userService.updateBalance(userId, numericAmount);

            if (newBalance === null) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                balance: newBalance
            });
        } catch (error: any) {
            log.error(`Error updating user balance: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Error updating user balance'
            });
        }
    }

    /**
     * Validate user exists and is active
     * @route GET /api/users/:userId/validate
     */
    async validateUser(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.userId;

            // Temporary implementation until service method is properly implemented
            const isValid = await userService.validateUser(userId); // Assume user is valid for now

            res.status(200).json({
                success: true,
                valid: isValid
            });
        } catch (error: any) {
            log.error(`Error validating user: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Error validating user',
                valid: false
            });
        }
    }

    /**
     * Check user withdrawal limits
     * @route POST /api/users/:userId/withdrawal-limits/check
     */
    async checkWithdrawalLimits(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.userId;
            const { amount } = req.body;

            // Validate input
            if (amount === undefined || isNaN(Number(amount))) {
                res.status(400).json({
                    success: false,
                    message: 'Valid amount is required',
                    allowed: false
                });
                return;
            }

            const numericAmount = Number(amount);

            // Temporary implementation until service method is properly implemented
            const result = await userService.checkWithdrawalLimits(userId, numericAmount);

            res.status(200).json({
                success: true,
                ...result
            });
        } catch (error: any) {
            log.error(`Error checking withdrawal limits: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Error checking withdrawal limits',
                allowed: false
            });
        }
    }

    /**
     * Register a new user
     * @route POST /api/users/register
     */
    async register(req: Request, res: Response): Promise<void> {
        try {
            log.info('Registering a new user');

            // Normalize sex field to lowercase if it exists
            const registrationData = { ...req.body };
            if (registrationData.sex && typeof registrationData.sex === 'string') {
                registrationData.sex = registrationData.sex.toLowerCase();
            }

            // Now returns { message, userId }
            const result = await userService.registerUser(registrationData, req.ip);
            res.status(200).json({ success: true, data: result }); // 200 OK, indicating next step is needed
        } catch (error: any) {
            log.error('Error registering a new user', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    /**
     * Login a user
     * @route POST /api/users/login
     */
    async login(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body;
            // Now returns { message, userId }
            const result = await userService.loginUser(email, password, req.ip);
            res.status(200).json({ success: true, data: result }); // 200 OK, indicating next step is needed
        } catch (error: any) {
            res.status(401).json({ success: false, message: error.message });
        }
    }

    /**
     * Verify OTP provided after registration or login
     * @route POST /api/users/verify-otp
     */
    async verifyOtp(req: Request, res: Response): Promise<void> {
        try {
            const { userId, otpCode } = req.body;
            if (!userId || !otpCode) {
                res.status(400).json({ success: false, message: 'User ID and OTP code are required' });
                return;
            }

            // Use 'otps' type for general login/registration verification
            const result = await userService.validateOtp(userId, 'otps', otpCode);
            // Ensure userId is a string before passing
            const userProfile = await userService.getUserProfile(userId.toString());

            if (result.isValid && result.newToken) {
                // If valid and a new token was generated, return it
                this.log.info(`OTP verification successful for userId: ${userId}`);
                res.status(200).json({ success: true, message: 'Verification successful', data: { token: result.newToken, user: userProfile } });
            } else {
                // If invalid or no token generated (e.g., wrong otpType used)
                this.log.warn(`OTP verification failed for userId: ${userId}`);
                res.status(401).json({ success: false, message: 'Invalid or expired OTP code' });
            }
        } catch (error: any) {
            this.log.error(`Error in verifyOtp for userId: ${req.body?.userId}: ${error.message}`);
            res.status(500).json({ success: false, message: 'Internal server error during OTP verification' });
        }
    }

    /**
     * Get current user profile
     * @route GET /api/users/me
     */
    async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            // User ID is attached by the authenticate middleware
            if (!req.user || !req.user.userId) {
                // This should technically not happen if middleware is applied correctly
                res.status(401).json({ success: false, message: 'Authentication error: User ID not found in token payload' });
                return;
            }

            const userId = req.user.userId;
            // Ensure userId is a string before passing
            const userProfile = await userService.getUserProfile(userId.toString());

            if (!userProfile) {
                res.status(404).json({ success: false, message: 'User profile not found' });
                return;
            }

            res.status(200).json({ success: true, data: userProfile });
        } catch (error: any) {
            this.log.error(`Error fetching user profile for userId: ${req.user?.userId}: ${error.message}`);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Logout a user
     * @route POST /api/users/logout
     */
    async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            if (!req.user?.userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }
            await userService.logoutUser(req.user.userId);
            res.status(200).json({ success: true, message: 'Logout successful' });
        } catch (error: any) {
            log.error("Error in logout", error);
            res.status(500).json({ success: false, message: 'Logout failed' });
        }
    }

    /**
     * Get user's affiliator
     * @route GET /api/users/affiliator
     */
    async getAffiliator(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const affiliator = await userService.getAffiliator(userId);

            if (!affiliator) {
                res.status(404).json({ success: false, message: 'Affiliator not found for this user' });
                return;
            }

            res.status(200).json({ success: true, data: affiliator });
        } catch (error: any) {
            log.error("Error in getAffiliator", error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Modify user profile (Protected Route)
     * Allows users to update their own profile information.
     * @route PUT /api/users/me 
     */
    async modify(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            // Extract updatable fields from request body
            const {
                name,
                region,
                country,
                city,
                phoneNumber,
                momoNumber,
                momoOperator,
                avatar,
                sex,
                birthDate,
                language,
                preferenceCategories,
                interests,
                profession,
                shareContactInfo,
                referralCode
            } = req.body;

            // Construct update object with only the fields provided
            const updateData: Record<string, any> = {};
            if (name !== undefined) updateData.name = name;
            if (region !== undefined) updateData.region = region;
            if (country !== undefined) updateData.country = country;
            if (city !== undefined) updateData.city = city;
            if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber; // Consider validation
            if (momoNumber !== undefined) updateData.momoNumber = momoNumber;
            if (momoOperator !== undefined) updateData.momoOperator = momoOperator;
            if (avatar !== undefined) updateData.avatar = avatar;
            if (sex !== undefined) updateData.sex = sex; // Consider validation against enum
            if (birthDate !== undefined) {
                // Basic validation: Check if it's a valid date string/number
                const parsedDate = new Date(birthDate);
                if (!isNaN(parsedDate.getTime())) {
                    updateData.birthDate = parsedDate;
                } else {
                    log.warn(`Invalid birthDate format provided by user ${userId}: ${birthDate}`);
                    // Optionally return a 400 error here
                    // return res.status(400).json({ success: false, message: 'Invalid birthDate format.' });
                }
            }
            if (language !== undefined) {
                // Basic validation: Ensure it's an array of strings
                if (Array.isArray(language) && language.every(l => typeof l === 'string')) {
                    updateData.language = language;
                } else {
                    log.warn(`Invalid language format provided by user ${userId}: ${language}`);
                    // Optionally return a 400 error here
                }
            }
            if (preferenceCategories !== undefined) updateData.preferenceCategories = preferenceCategories; // Consider validation
            if (interests !== undefined) updateData.interests = interests; // Consider validation
            if (profession !== undefined) updateData.profession = profession; // Consider validation
            if (shareContactInfo !== undefined) updateData.shareContactInfo = shareContactInfo;
            if (referralCode !== undefined) updateData.referralCode = referralCode;

            // Check if there is anything to update
            if (Object.keys(updateData).length === 0) {
                res.status(400).json({ success: false, message: 'No valid fields provided for update' });
                return;
            }

            log.info(`Updating user profile for userId: ${userId} with data: ${JSON.stringify(updateData)}`);

            // Call the service to perform the update
            const updatedUser = await userService.updateUserProfile(userId, updateData);

            if (!updatedUser) {
                // This might happen if the user was deleted between token validation and update
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Return the updated profile (excluding sensitive fields)
            res.status(200).json({ success: true, data: updatedUser });

        } catch (error: any) {
            log.error(`Error modifying user profile: ${error.message}`);
            // Handle specific errors, e.g., duplicate phone number if changed
            if (error.message.includes('duplicate key') && error.message.includes('phoneNumber')) {
                res.status(409).json({ success: false, message: 'Phone number is already in use.' });
            } else {
                res.status(500).json({ success: false, message: 'Failed to update profile' });
            }
        }
    }

    /**
     * Get users referred by the current user, optionally filtered by level and name.
     * @route GET /api/users/get-refered-users
     */
    async getReferredUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            // Extract query parameters
            const { level: levelQuery, name: nameFilter, page: pageQuery = '1', limit: limitQuery = '10' } = req.query;

            // Validate level
            const level = levelQuery ? parseInt(levelQuery as string, 10) : undefined;
            if (level !== undefined && (isNaN(level) || ![1, 2, 3].includes(level))) {
                res.status(400).json({ success: false, message: 'Invalid level parameter. Must be 1, 2, or 3.' });
                return;
            }

            // Validate pagination
            const page = parseInt(pageQuery as string, 10) || 1;
            const limit = parseInt(limitQuery as string, 10) || 10;

            // Call the CORRECT service method with filters
            const result = await userService.getReferredUsersInfoPaginated(
                userId,
                level,
                nameFilter as string | undefined, // Pass name filter
                page,
                limit
            );
            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            log.error("Error in getReferredUsers controller", error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Get referral statistics
     * @route GET /api/users/get-referals
     */
    async getReferredUsersInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            // Get referral statistics for the user
            const referralStats = await userService.getReferralStats(userId);

            res.status(200).json({
                success: true,
                data: {
                    ...referralStats,
                },
                message: 'Referral statistics retrieved successfully'
            });
        } catch (error: any) {
            log.error("Error in getReferredUsersInfo", error);
            res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    /**
     * Get user products
     * @route GET /api/users/get-products
     */
    async getUserProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
        // Should likely call ProductService
        res.status(501).json({ success: false, message: 'Get User Products: Not Implemented Yet (requires Product Service)' });
    }

    /**
     * Get specific user product
     * @route GET /api/users/get-product
     */
    async getUserProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
        // Should likely call ProductService
        res.status(501).json({ success: false, message: 'Get User Product: Not Implemented Yet (requires Product Service)' });
    }

    /**
     * Get user information by affiliation code
     * @route GET /api/users/get-affiliation
     */
    async getAffiliation(req: Request, res: Response): Promise<void> {
        try {
            const { referralCode } = req.query;

            if (!referralCode || typeof referralCode !== 'string') {
                res.status(400).json({ success: false, message: 'Valid referral code is required' });
                return;
            }

            const user = await userService.getUserByReferralCode(referralCode);

            if (!user) {
                res.status(404).json({ success: false, message: 'No user found with this referral code' });
                return;
            }

            // Return only the necessary information
            res.status(200).json({
                success: true,
                data: {
                    name: user.name,
                    email: user.email
                }
            });
        } catch (error: any) {
            log.error(`Error getting affiliation information: ${error.message}`);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Export filtered contacts as CSV
     * Access controlled by subscription type.
     * @route GET /api/contacts/export
     */
    async exportContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
        this.log.info('Request received for exporting contacts');
        if (!req.user || !req.user.userId) {
            this.log.warn('Export contacts failed: Missing user ID in authenticated request');
            res.status(401).json({ success: false, message: 'Authentication error' });
            return;
        }
        const userId = req.user.userId;

        try {
            // --- Subscription Check ---
            const activeSubTypes = await this.subscriptionService.getActiveSubscriptionTypes(userId);
            if (!activeSubTypes || activeSubTypes.length === 0) {
                this.log.warn(`User ${userId} attempted contact export without active subscription.`);
                res.status(403).json({ success: false, message: 'Active subscription required to export contacts.' });
                return;
            }
            const hasCible = activeSubTypes.includes(SubscriptionType.CIBLE);
            const hasClassique = activeSubTypes.includes(SubscriptionType.CLASSIQUE);
            // --- End Subscription Check ---

            // --- Filter Validation ---
            const queryFilters = req.query;
            const allowedFilters: (keyof ContactSearchFilters)[] = ['country']; // Base allowed for CLASSIQUE
            let useAdvancedFilters = false;

            if (hasCible) {
                // CIBLE allows all filters
                useAdvancedFilters = true;
                // No need to restrict filters here
            } else if (hasClassique) {
                // CLASSIQUE only allows 'country'
                for (const key in queryFilters) {
                    if (Object.prototype.hasOwnProperty.call(queryFilters, key)) {
                        // Allow pagination/sorting fields if you add them later
                        const allowedKeys = ['country', 'page', 'limit', 'sortBy', 'sortOrder', 'startDate', 'endDate'];
                        if (!allowedKeys.includes(key)) {
                            this.log.warn(`User ${userId} (CLASSIQUE) attempted export with disallowed filter: ${key}`);
                            res.status(403).json({ success: false, message: `Your current plan only allows filtering by country. Filter '${key}' is not permitted.` });
                            return;
                        }
                    }
                }
            } else {
                // Should have been caught by the initial check, but defensive programming
                res.status(403).json({ success: false, message: 'Active subscription required.' });
                return;
            }
            // --- End Filter Validation ---


            // Extract and format filters (same logic as search)
            const filters: ContactSearchFilters = this.extractContactFilters(queryFilters);

            // Add the requirement that contacts must have an active subscription
            const finalFilters: ContactSearchFilters = {
                ...filters,
                requireActiveSubscription: true // Add flag for service layer
            };

            this.log.debug(`Exporting contacts for user ${userId} with filters:`, finalFilters);

            // Call user service to get filtered contacts (without pagination for export)
            // Assuming a method like `findAllUsersByCriteria` exists or modify `findUsersByCriteria`
            const contacts: Partial<IUser>[] = await userService.findAllUsersByCriteria(finalFilters);

            this.log.info(`Found ${contacts.length} contacts to export for user ${userId}`);

            if (contacts.length === 0) {
                // Send an empty VCF file
                res.setHeader('Content-Type', 'text/vcard');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
                res.status(200).send('');
                return;
            }

            // Generate VCF string
            let vcfString = '';
            const filtersApplied = req.query; // Get the original query params

            for (const userContact of contacts) {
                // Cast the contact to IUser here to access properties safely
                const contact = userContact as IUser;

                const vCardLines = [
                    'BEGIN:VCARD',
                    'VERSION:3.0',
                    // FN and N: Use contact name, append " SBC"
                    `FN;CHARSET=UTF-8:${contact.name || 'Unknown'} SBC`,
                    `N;CHARSET=UTF-8:;${contact.name || 'Unknown'} SBC;;;`,
                    // UID: Use contact ID
                    `UID;CHARSET=UTF-8:${contact._id?.toString() || ''}`,
                    // TEL: Use phone number (add prefix if needed, assumes it's stored with prefix)
                    `TEL;TYPE=CELL:${contact.phoneNumber || ''}`,
                    // REV: Use createdAt timestamp in ISO format
                    `REV:${contact.createdAt ? new Date(contact.createdAt).toISOString() : new Date().toISOString()}`
                ];

                // --- Conditional Fields ---
                // Always add Country if available
                if (contact.country) {
                    vCardLines.push(`X-COUNTRY:${contact.country}`);
                }

                // Add Region if filtered and available
                if (filtersApplied.region && contact.region) {
                    vCardLines.push(`X-REGION:${contact.region}`);
                }

                // Add City if filtered
                if (filtersApplied.city && (contact.city || contact.ipCity)) {
                    vCardLines.push(`X-CITY:${contact.city || contact.ipCity}`);
                }

                // Add Gender if filtered
                if (filtersApplied.sex && contact.sex) {
                    let genderVcf = 'O'; // Other/Unknown
                    if (contact.sex === 'male') genderVcf = 'M';
                    if (contact.sex === 'female') genderVcf = 'F';
                    vCardLines.push(`GENDER:${genderVcf}`);
                }

                // Add Birthday if age was filtered
                if ((filtersApplied.minAge || filtersApplied.maxAge) && contact.birthDate) {
                    try {
                        const bday = new Date(contact.birthDate);
                        // Format as YYYY-MM-DD
                        const formattedBday = bday.toISOString().split('T')[0];
                        vCardLines.push(`BDAY:${formattedBday}`);
                    } catch (e) { /* Ignore invalid date */ }
                }

                // Add Language if filtered
                if (filtersApplied.language && contact.language) {
                    // Assuming language is stored as a string, potentially needs mapping to standard codes if not
                    vCardLines.push(`LANG:${contact.language}`);
                }

                // Add Profession/Title if filtered
                if (filtersApplied.profession && contact.profession) {
                    vCardLines.push(`TITLE:${contact.profession}`);
                }

                // Add Interests/Categories if filtered
                if (filtersApplied.interests && Array.isArray(contact.interests) && contact.interests.length > 0) {
                    vCardLines.push(`CATEGORIES:${contact.interests.join(',')}`);
                }
                // --- End Conditional Fields ---

                vCardLines.push('END:VCARD');
                vcfString += vCardLines.join('\r\n') + '\r\n'; // Use CRLF line endings for VCF
            }

            // Set headers for VCF download
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
            res.status(200).send(vcfString);

        } catch (error: any) {
            this.log.error(`Error exporting contacts for user ${userId}:`, error);
            res.status(500).json({ success: false, message: 'Failed to export contacts.' });
        }
    }

    /**
     * Get referrer IDs for commission calculation based on user ID and date range.
     * @route GET /api/users/:userId/referrers
     */
    async getReferrerIdsForCommission(req: Request, res: Response): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid userId format' });
            return;
        }

        try {
            const referrers = await userService.getReferrerIds(userId);
            res.status(200).json({ success: true, data: referrers });
        } catch (error) {
            log.error(`Error getting referrer IDs for user ${userId}:`, error);
            res.status(500).json({ success: false, message: 'Failed to get referrer IDs' });
        }
    }

    /**
     * Handles internal request to find users based on criteria.
     * POST /internal/users/find-by-criteria
     */
    async findUsersByCriteria(req: Request, res: Response, next: NextFunction): Promise<void> {
        const criteria: ITargetCriteria = req.body;
        const callingService = req.header('X-Service-Name') || 'Unknown Service';

        // Basic validation (could be more robust)
        if (!criteria || typeof criteria !== 'object' || Object.keys(criteria).length === 0) {
            log.warn('Received invalid criteria payload for user search.', { criteria });
            res.status(400).json({ success: false, message: 'Invalid or empty criteria provided.' });
            return;
        }

        log.info(`Received request from ${callingService} to find users by criteria.`);
        log.debug('Criteria:', criteria);

        try {
            // Limit results internally to prevent excessively large responses
            const MAX_RESULTS = 10000; // Example limit, adjust as needed
            const userIds = await userService.findUserIdsByCriteria(criteria, MAX_RESULTS);

            log.info(`Found ${userIds.length} user IDs matching criteria for ${callingService}.`);
            res.status(200).json({
                success: true,
                message: 'User IDs retrieved successfully.',
                data: {
                    userIds: userIds, // Return only the IDs
                },
            });
        } catch (error: any) {
            log.error(`Error finding users by criteria for ${callingService}:`, error);
            // Use generic error handler since AppError is not available
            next(error);
        }
    }

    /**
     * Search for contact users with filtering.
     * Access controlled by subscription type.
     * @route GET /api/contacts/search
     */
    async searchContactUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        this.log.info('Request received for searching contacts');
        if (!req.user || !req.user.userId) {
            this.log.warn('Contact search failed: Missing user ID in authenticated request');
            res.status(401).json({ success: false, message: 'Authentication error' });
            return;
        }
        const userId = req.user.userId;

        try {
            // --- Subscription Check ---
            const activeSubTypes = await this.subscriptionService.getActiveSubscriptionTypes(userId);
            if (!activeSubTypes || activeSubTypes.length === 0) {
                this.log.warn(`User ${userId} attempted contact search without active subscription.`);
                res.status(403).json({ success: false, message: 'Active subscription required to search contacts.' });
                return;
            }
            const hasCible = activeSubTypes.includes(SubscriptionType.CIBLE);
            const hasClassique = activeSubTypes.includes(SubscriptionType.CLASSIQUE);
            // --- End Subscription Check ---

            // --- Filter Validation ---
            const queryFilters = req.query;
            const allowedFilters = ['country', 'page', 'limit', 'startDate', 'endDate']; // Base allowed for CLASSIQUE + pagination
            let useAdvancedFilters = false;

            if (hasCible) {
                // CIBLE allows all filters
                useAdvancedFilters = true;
                // No specific filter restriction needed here, service layer will handle validation of values
            } else if (hasClassique) {
                // CLASSIQUE only allows 'country' + pagination
                for (const key in queryFilters) {
                    if (Object.prototype.hasOwnProperty.call(queryFilters, key)) {
                        if (!allowedFilters.includes(key as keyof ContactSearchFilters)) {
                            this.log.warn(`User ${userId} (CLASSIQUE) attempted search with disallowed filter: ${key}`);
                            res.status(403).json({ success: false, message: `Your current plan only allows filtering by country. Filter '${key}' is not permitted.` });
                            return;
                        }
                    }
                }
            } else {
                // Should have been caught by the initial check
                res.status(403).json({ success: false, message: 'Active subscription required.' });
                return;
            }
            // --- End Filter Validation ---

            // Extract pagination and filters
            const { page = 1, limit = 10 } = req.query;
            const pagination: PaginationOptions = {
                page: parseInt(page as string, 10) || 1,
                limit: parseInt(limit as string, 10) || 10,
            };
            const filters: ContactSearchFilters = this.extractContactFilters(queryFilters);

            // Add the requirement that contacts must have an active subscription
            const finalFilters: ContactSearchFilters = {
                ...filters,
                requireActiveSubscription: true // Add flag for service layer
            };

            this.log.debug(`Searching contacts for user ${userId} with filters: ${JSON.stringify(finalFilters)}, pagination: ${JSON.stringify(pagination)}`);

            // Call service to find users based on criteria
            const result = await userService.findUsersByCriteria(finalFilters, pagination);

            res.status(200).json({
                success: true,
                data: result.users,
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    totalCount: result.totalCount,
                    totalPages: result.totalPages,
                },
            });

        } catch (error: any) {
            this.log.error(`Error searching contact users for user ${userId}:`, error);
            next(error); // Pass to global error handler
        }
    }

    /**
     * Helper to extract and structure filters from query parameters.
     */
    private extractContactFilters(query: any): ContactSearchFilters {
        const filters: ContactSearchFilters = {};
        if (query.country) filters.country = query.country as string;
        if (query.region) filters.region = query.region as string;
        if (query.city) filters.city = query.city as string;
        if (query.minAge) filters.minAge = parseInt(query.minAge as string, 10);
        if (query.maxAge) filters.maxAge = parseInt(query.maxAge as string, 10);
        if (query.sex && Object.values(UserSex).includes(query.sex as UserSex)) filters.sex = query.sex as UserSex;
        if (query.language) filters.language = query.language as string;
        if (query.profession) filters.profession = query.profession as string;
        // Handle interests which can be a single value or an array
        if (query.interests) {
            filters.interests = Array.isArray(query.interests) ? query.interests : [query.interests];
        }

        // Add date filters
        if (query.startDate) { // Accept startDate
            const startDate = new Date(query.startDate as string);
            if (!isNaN(startDate.getTime())) {
                filters.registrationDateStart = startDate;
            } else {
                this.log.warn(`Invalid startDate format provided: ${query.startDate}`);
                // Optionally throw an error or handle as a bad request
            }
        } else if (query.registrationDateStart) { // Keep existing logic as fallback
            const startDate = new Date(query.registrationDateStart as string);
            if (!isNaN(startDate.getTime())) {
                filters.registrationDateStart = startDate;
            } else {
                this.log.warn(`Invalid registrationDateStart format provided: ${query.registrationDateStart}`);
            }
        }

        if (query.endDate) { // Accept endDate
            const endDate = new Date(query.endDate as string);
            if (!isNaN(endDate.getTime())) {
                // To make the endDate inclusive of the whole day
                endDate.setHours(23, 59, 59, 999);
                filters.registrationDateEnd = endDate;
            } else {
                this.log.warn(`Invalid endDate format provided: ${query.endDate}`);
                // Optionally throw an error or handle as a bad request
            }
        } else if (query.registrationDateEnd) { // Keep existing logic as fallback
            const endDate = new Date(query.registrationDateEnd as string);
            if (!isNaN(endDate.getTime())) {
                endDate.setHours(23, 59, 59, 999);
                filters.registrationDateEnd = endDate;
            }
            else {
                this.log.warn(`Invalid registrationDateEnd format provided: ${query.registrationDateEnd}`);
            }
        }

        // Add simple validation/sanitization if needed (e.g., check NaN for ages)
        if (isNaN(filters.minAge as number)) delete filters.minAge;
        if (isNaN(filters.maxAge as number)) delete filters.maxAge;

        return filters;
    }

    /**
     * Get details for multiple users by their IDs
     * @route POST /api/users/internal/batch-details
     */
    async getUsersDetailsByIds(req: Request, res: Response): Promise<void> {
        try {
            const { userIds } = req.body;

            if (!Array.isArray(userIds) || userIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'An array of user IDs must be provided in the request body.',
                });
                return;
            }

            // Validate each ID - optional but good practice
            const invalidIds = userIds.filter(id => !isValidObjectId(id));
            if (invalidIds.length > 0) {
                res.status(400).json({
                    success: false,
                    message: `Invalid user IDs found: ${invalidIds.join(', ')}`,
                });
                return;
            }

            // Convert valid string IDs to ObjectIds if needed by the service (service handles this now)
            const usersDetails = await userService.getUsersByIds(userIds);

            res.status(200).json({
                success: true,
                data: usersDetails,
            });
        } catch (error: any) {
            this.log.error(`Error getting user details by IDs: ${error.message}`, error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve user details.',
            });
        }
    }

    /**
     * [Internal] Find user IDs matching a search term (name, email, phone).
     * @route GET /api/users/internal/search-ids?q=<searchTerm>
     */
    async findUserIdsBySearchTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
        const searchTerm = req.query.q as string | undefined;

        if (!searchTerm || searchTerm.trim() === '') {
            res.status(400).json({ success: false, message: 'Search query parameter \'q\' is required.' });
            return;
        }

        this.log.info(`Internal request to find user IDs matching search term: "${searchTerm}"`);
        try {
            const userIds = await userService.findUserIdsBySearchTerm(searchTerm.trim());
            res.status(200).json({ success: true, data: { userIds } });
        } catch (error) {
            this.log.error(`Error finding user IDs by search term '${searchTerm}':`, error);
            // Pass to generic error handler
            next(error);
        }
    }

    /**
     * Upload/Update User Avatar
     * @route PUT /api/users/me/avatar
     */
    public uploadAvatar = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        log.info(`Request to upload avatar for user ${req.user?.userId}`);
        try {
            if (!req.file) {
                throw new AppError('No avatar file uploaded.', 400);
            }
            if (!req.user?.userId) {
                throw new AppError('User ID not found in authenticated request.', 401);
            }

            const file = req.file;
            const userId = req.user.userId;

            // Call the service method to handle upload and update
            const updatedUser = await userService.updateAvatar(
                userId,
                file.buffer,
                file.mimetype,
                file.originalname
            );

            res.status(200).json({
                success: true,
                message: 'Avatar updated successfully',
                data: { avatar: updatedUser.avatar } // Return new avatar URL
            });
        } catch (error) {
            log.error(`Error uploading avatar for user ${req.user?.userId}:`, error);
            next(error); // Pass error to global error handler
        }
    }

    /**
     * Proxy route to get user avatar
     * @route GET /api/users/avatar/:fileId
     */
    public getAvatar = async (req: Request, res: Response, next: NextFunction) => {
        const { fileId } = req.params;
        log.info(`Request to proxy avatar with fileId: ${fileId}`);
        try {
            if (!fileId) {
                throw new AppError('File ID is required', 400);
            }
            // Get the stream from settings service via user service
            const { stream, contentType } = await userService.getAvatarStream(fileId);

            // Set content type header
            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }
            // Set caching headers (optional but recommended)
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

            // Pipe the stream to the response
            stream.pipe(res);

            // Handle stream errors
            stream.on('error', (err) => {
                log.error(`Error streaming avatar ${fileId}:`, err);
                // Avoid sending headers again if already sent
                if (!res.headersSent) {
                    next(new AppError('Failed to stream avatar file', 500));
                }
            });

        } catch (error) {
            log.error(`Error proxying avatar ${fileId}:`, error);
            next(error);
        }
    }

    /**
     * Get public user profile by ID
     * @route GET /api/users/:userId
     * @access Authenticated Users
     */
    async viewUserProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { userId } = req.params;

            if (!userId || !isValidObjectId(userId)) {
                res.status(400).json({ success: false, message: 'Valid User ID parameter is required' });
                return;
            }

            const profile = await userService.getPublicUserProfile(userId);

            if (!profile) {
                // Could be not found, deleted, blocked, or sharing disabled
                res.status(404).json({ success: false, message: 'User profile not found or not accessible' });
                return;
            }

            res.status(200).json({ success: true, data: profile });
        } catch (error: any) {
            log.error(`Error viewing user profile: ${error.message}`);
            next(error); // Pass to central error handler
        }
    }

    /**
     * Resend OTP code
     * @route POST /api/users/resend-otp
     */
    async resendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, purpose } = req.body;

            // Basic validation
            if (!email || typeof email !== 'string' || !email.includes('@')) {
                res.status(400).json({ success: false, message: 'Valid email address is required.' });
                return;
            }
            // Optional: Validate purpose against a known list if desired, but service can handle unknown purposes gracefully.
            const validPurposes = ['login', 'register', 'forgotPassword', 'changeEmail'];
            if (!purpose || typeof purpose !== 'string' || !validPurposes.includes(purpose)) {
                res.status(400).json({ success: false, message: `Valid purpose is required (${validPurposes.join(', ')}).` });
                return;
            }

            // Call the service method. It handles logic internally and doesn't throw errors based on user existence.
            await userService.resendOtp(email, purpose);

            // Send a generic success response to prevent leaking information about account existence.
            res.status(200).json({ success: true, message: 'If an account with this email exists, an OTP has been sent.' });

        } catch (error: any) {
            // Catch potential unexpected errors from the service layer (e.g., notification service failure if not handled internally)
            this.log.error(`Unexpected error during OTP resend for email ${req.body?.email}:`, error);
            // Still send a generic message, but log the internal error
            res.status(500).json({ success: false, message: 'An error occurred while processing your request.' });
        }
    }

    /**
     * Request OTP for password reset
     * @route POST /api/users/request-password-reset
     */
    async requestPasswordResetOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body;
            if (!email || typeof email !== 'string' || !email.includes('@')) {
                res.status(400).json({ success: false, message: 'Valid email address is required.' });
                return;
            }

            await userService.requestPasswordResetOtp(email);

            // Always return success to prevent email enumeration
            res.status(200).json({ success: true, message: 'If an account exists for this email, a password reset OTP has been sent.' });

        } catch (error: any) {
            log.error('[Controller] Error requesting password reset OTP:', error);
            // Send generic error to client, details logged internally
            res.status(500).json({ success: false, message: 'An error occurred while processing your request.' });
            // Note: No need to call next(error) unless you have a dedicated error middleware
        }
    }

    /**
     * Request OTP to verify a new email address (Requires Authentication)
     * @route POST /api/users/request-change-email
     */
    async requestChangeEmailOtp(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required.' });
                return;
            }

            const { newEmail } = req.body;
            if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
                res.status(400).json({ success: false, message: 'Valid new email address is required.' });
                return;
            }

            await userService.requestChangeEmailOtp(userId, newEmail);

            // Return success message indicating OTP sent to the NEW email
            res.status(200).json({ success: true, message: `An OTP has been sent to ${newEmail} to verify the change.` });

        } catch (error: any) {
            log.error(`[Controller] Error requesting change email OTP for user ${req.user?.userId}:`, error);
            // If AppError, use its message and status, otherwise generic 500
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                res.status(500).json({ success: false, message: 'An error occurred while processing your request.' });
            }
        }
    }

    /**
     * Handles the password reset request.
     */
    async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, otpCode, newPassword } = req.body;

            if (!email || !otpCode || !newPassword) {
                res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
                return;
            }

            await userService.resetPassword(email, otpCode, newPassword);

            res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (error) {
            log.error('Password reset failed:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                res.status(500).json({ success: false, message: 'An internal error occurred during password reset.' });
            }
        }
    }

    /**
     * Handles the email change confirmation request.
     */
    async confirmChangeEmail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // User ID comes from the authenticated request middleware
            const userId = req.user?.userId; // Or req.user?._id depending on auth middleware
            const { newEmail, otpCode } = req.body;

            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required.' });
                return;
            }
            if (!newEmail || !otpCode) {
                res.status(400).json({ success: false, message: 'New email and OTP are required.' });
                return;
            }

            await userService.confirmChangeEmail(userId, newEmail, otpCode);

            res.status(200).json({ success: true, message: 'Email change confirmed successfully.' });

        } catch (error) {
            log.error('Email change confirmation failed:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                res.status(500).json({ success: false, message: 'An internal error occurred during email change confirmation.' });
            }
        }
    }

}

// Export singleton instance
export const userController = new UserController(); 