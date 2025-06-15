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
import { normalizePhoneNumber } from '../../utils/phone.utils';
import { UserRole } from '../../database/models/user.model';
import { authorize } from '../middleware/rbac.middleware';
import { notificationService, DeliveryChannel } from '../../services/clients/notification.service.client';

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
    private subscriptionService = subscriptionService;
    private userService = userService;

    constructor() {
        // Constructor body if any
    }

    /**
     * Get user balance
     * @route GET /api/users/:userId/balance
     */
    async getUserBalance(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.params.userId;

            // Verify the user exists
            const user = await this.userService.getUserProfile(userId);
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            res.status(200).json({
                success: true,
                data: {
                    balance: user.balance
                }
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
            const newBalance = await this.userService.updateBalance(userId, numericAmount);

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
            const isValid = await this.userService.validateUser(userId); // Assume user is valid for now

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
                    allowed: false,
                    // data: {
                    //     amount: 0,
                    //     dailyLimit: 0,
                    //     dailyRemaining: 0
                    // }
                });
                return;
            }

            const numericAmount = Number(amount);

            // Temporary implementation until service method is properly implemented
            const result = await this.userService.checkWithdrawalLimits(userId, numericAmount);

            res.status(200).json({
                success: true,
                data: {
                    ...result
                }
            });
        } catch (error: any) {
            log.error(`Error checking withdrawal limits: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Error checking withdrawal limits',
                allowed: false,
                // data: {
                //     amount: 0,
                //     dailyLimit: 0,
                //     dailyRemaining: 0
                // }
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

            // --- Phone Number Normalization ---
            if (registrationData.phoneNumber && typeof registrationData.phoneNumber === 'string') {
                const normalizedPhone = normalizePhoneNumber(registrationData.phoneNumber, registrationData.country);
                if (normalizedPhone) {
                    registrationData.phoneNumber = normalizedPhone;
                    log.info(`Phone number normalized during registration to: ${normalizedPhone}`);
                } else {
                    log.warn(`Phone number normalization failed for registration. Raw: ${registrationData.phoneNumber}, Country: ${registrationData.country}`);
                    res.status(400).json({ success: false, message: 'Invalid phone number or country code provided. Please ensure the phone number matches the selected country.' });
                    return;
                }
            } else if (registrationData.phoneNumber) { // If phoneNumber is present but not a string or country missing for normalization
                log.warn(`Phone number provided for registration but country code missing or phone not a string. Raw: ${registrationData.phoneNumber}, Country: ${registrationData.country}`);
                res.status(400).json({ success: false, message: 'A valid phone number and country code are required for phone number registration.' });
                return;
            }
            // --- End Phone Number Normalization ---

            // Now returns { message, userId }
            const result = await this.userService.registerUser(registrationData, req.ip);

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
            const result = await this.userService.loginUser(email, password, req.ip);
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
            const result = await this.userService.validateOtp(userId, 'otps', otpCode);
            // Ensure userId is a string before passing
            const userProfile = await this.userService.getUserProfile(userId.toString());

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
            const userProfile = await this.userService.getUserProfile(userId.toString());

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
            await this.userService.logoutUser(req.user.userId);
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

            const affiliator = await this.userService.getAffiliator(userId);

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
            if (phoneNumber !== undefined) {
                // --- Phone Number Normalization for Update ---
                // For phone number updates, we need the country.
                // If `country` is also being updated, use that. Otherwise, fetch the user's current country.
                let countryForNormalization = country; // Country from request body
                if (!countryForNormalization) {
                    const currentUser = await this.userService.getUserProfile(userId); // Fetch current profile
                    if (currentUser && currentUser.country) {
                        countryForNormalization = currentUser.country;
                    }
                }

                if (phoneNumber && typeof phoneNumber === 'string' && countryForNormalization) {
                    const normalizedPhone = normalizePhoneNumber(phoneNumber, countryForNormalization);
                    if (normalizedPhone) {
                        updateData.phoneNumber = normalizedPhone;
                        log.info(`Phone number normalized during profile update for user ${userId} to: ${normalizedPhone}`);
                    } else {
                        log.warn(`Phone number normalization failed during profile update for user ${userId}. Raw: ${phoneNumber}, Country: ${countryForNormalization}`);
                        res.status(400).json({ success: false, message: 'Invalid phone number or country code provided for update. Please ensure the phone number matches the selected country.' });
                        return;
                    }
                } else if (phoneNumber && typeof phoneNumber === 'string' && !countryForNormalization) {
                    // Phone provided but couldn't determine country for normalization
                    log.warn(`Phone number update for user ${userId} provided, but country code could not be determined for normalization. Raw: ${phoneNumber}`);
                    res.status(400).json({ success: false, message: 'Country code is required to update the phone number.' });
                    return;
                } else if (phoneNumber) { // phone number present but not a string
                    log.warn(`Invalid phone number format provided for update by user ${userId}: ${phoneNumber}`);
                    res.status(400).json({ success: false, message: 'Invalid phone number format.' });
                    return;
                }
                // If phoneNumber is explicitly set to null or empty string to remove it, that's handled by the service/model.
                // Normalization is only for non-empty string inputs.
                // --- End Phone Number Normalization ---
            } else {
                // If phoneNumber is not in updateData, but was included in destructuring, assign it to keep existing logic flow
                if (req.body.phoneNumber !== undefined) updateData.phoneNumber = req.body.phoneNumber;
            }
            if (momoNumber !== undefined) updateData.momoNumber = momoNumber;
            if (momoOperator !== undefined) updateData.momoOperator = momoOperator;
            if (avatar !== undefined) updateData.avatar = avatar;
            if (sex !== undefined) updateData.sex = sex.toLowerCase(); // Consider validation against enum
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
            const updatedUser = await this.userService.updateUserProfile(userId, updateData);

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
            const { level: levelQuery, name: nameFilter, page: pageQuery = '1', limit: limitQuery = '10', type: typeQuery = undefined, subType: subTypeQuery = undefined } = req.query;

            // Validate level and type
            let level = levelQuery ? parseInt(levelQuery as string, 10) : undefined;

            // Validate type parameter and set level accordingly
            if (typeQuery) {
                if (!['direct', 'indirect', 'all'].includes(typeQuery as string)) {
                    res.status(400).json({ success: false, message: 'Invalid type parameter. Must be direct, indirect, or all.' });
                    return;
                }

                // Set level based on type if not explicitly provided
                if (!levelQuery) {
                    if (typeQuery === 'direct') {
                        level = 1;
                    } else if (typeQuery === 'indirect') {
                        level = 2; // Will include both level 2 and 3 in the service
                    }
                }
            }

            // Validate level if explicitly provided
            if (level !== undefined && (isNaN(level) || ![1, 2, 3].includes(level))) {
                res.status(400).json({ success: false, message: 'Invalid level parameter. Must be 1, 2, or 3.' });
                return;
            }

            // Validate subType parameter
            let subType: string | undefined = undefined;
            if (subTypeQuery) {
                // Use spread operator to correctly combine string literals with enum values
                const validSubTypes: string[] = [...Object.values(SubscriptionType), 'all', 'none'];
                if (!validSubTypes.includes(subTypeQuery as string)) {
                    res.status(400).json({ success: false, message: `Invalid subType parameter. Must be one of: ${validSubTypes.join(', ')}.` });
                    return;
                }
                subType = subTypeQuery as string;
            }

            // Validate pagination
            const page = parseInt(pageQuery as string, 10) || 1;
            const limit = parseInt(limitQuery as string, 10) || 10;

            // Call the CORRECT service method with filters
            const result = await this.userService.getReferredUsersInfoPaginated(
                userId,
                level,
                nameFilter as string | undefined, // Pass name filter
                page,
                limit,
                subType // Pass subType
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
            const referralStats = await this.userService.getReferralStats(userId);

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

            const user = await this.userService.getUserByReferralCode(referralCode);

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
     * Export filtered contacts as VCF (blazingly fast using cached file)
     * Access controlled by subscription type.
     * @route GET /api/contacts/export
     */
    async exportContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
        this.log.info('Request received for exporting contacts (cached VCF)');
        // Ensure email is available in the authenticated request for sending emails
        if (!req.user || !req.user.userId || !req.user.email) {
            this.log.warn('Export contacts failed: Missing user ID or email in authenticated request');
            res.status(401).json({ success: false, message: 'Authentication error' });
            return;
        }
        const userId = req.user.userId;
        const userEmail = req.user.email; // Get user's email from authenticated request

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

            // Import VCF cache service
            const { vcfCacheService } = await import('../../services/vcf-cache.service');

            // --- Check for query parameters (filters) ---
            const hasFilters = Object.keys(req.query).length > 0;

            if (hasFilters) {
                // If user provided filters, fall back to the old dynamic generation method
                this.log.info(`User ${userId} requested filtered export, using dynamic generation`);
                return this.exportContactsWithFilters(req, res);
            }

            // --- Use Cached VCF File for unfiltered exports ---
            this.log.info(`User ${userId} requested unfiltered export, using cached VCF file`);

            try {
                // Ensure we have a fresh VCF file (regenerate if older than 60 minutes)
                await vcfCacheService.ensureFreshVCFFile(60);

                // Get the cached VCF content
                const vcfContent = await vcfCacheService.getVCFContent();

                if (!vcfContent || vcfContent.trim().length === 0) {
                    this.log.warn('Cached VCF file is empty, falling back to dynamic generation');
                    return this.exportContactsWithFilters(req, res);
                }

                // Get file stats for logging
                const stats = await vcfCacheService.getFileStats();
                this.log.info(`Serving cached VCF file to user ${userId}. Contacts: ${stats.contactCount}, Size: ${stats.size} bytes`);

                // ASYNC: Send the VCF file as an email attachment in the background
                // This call is not awaited so it doesn't block the HTTP response for the download.
                // Any errors here are logged but do not prevent the file from being downloaded.
                this.userService.sendContactsVcfEmail(userId, userEmail, vcfContent, 'SBC_all_contacts.vcf')
                    .catch(emailError => log.error(`Background VCF email send failed for user ${userId}:`, emailError));


                // Set headers for VCF download (original behavior)
                res.setHeader('Content-Type', 'text/vcard');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
                res.setHeader('Content-Length', Buffer.byteLength(vcfContent, 'utf8'));
                res.status(200).send(vcfContent);
                return;

            } catch (cacheError: any) {
                this.log.error(`Error using cached VCF file for user ${userId}:`, cacheError);
                this.log.info('Falling back to dynamic generation');
                return this.exportContactsWithFilters(req, res);
            }

        } catch (error: any) {
            this.log.error(`Error in exportContacts for user ${userId}:`, error);
            res.status(500).json({ success: false, message: 'Failed to export contacts.' });
        }
    }

    /**
     * Export contacts with filters (optimized with popular filter cache)
     * Used as fallback when filters are applied or cached file is unavailable
     */
    private async exportContactsWithFilters(req: AuthenticatedRequest, res: Response): Promise<void> {
        // Ensure email is available in the authenticated request
        const userId = req.user!.userId;
        const userEmail = req.user!.email;

        try {
            // Get subscription types (already validated in main method)
            const activeSubTypes = await this.subscriptionService.getActiveSubscriptionTypes(userId);
            const hasCible = activeSubTypes.includes(SubscriptionType.CIBLE);
            const hasClassique = activeSubTypes.includes(SubscriptionType.CLASSIQUE);

            // Extract and format filters (same logic as search)
            const extractedFilters: ContactSearchFilters = this.extractContactFilters(req.query);

            // Try to get cached result for popular filter combinations
            const { popularFiltersCacheService } = await import('../../services/popular-filters-cache.service');
            const cachedResult = await popularFiltersCacheService.getCachedResult(extractedFilters);

            if (cachedResult) {
                this.log.info(`Serving cached filter result to user ${userId}. Filter: ${JSON.stringify(extractedFilters)}`);

                // ASYNC: Send the VCF file as an email attachment in the background
                this.userService.sendContactsVcfEmail(userId, userEmail, cachedResult, `SBC_filtered_contacts_${new Date().toISOString().slice(0, 10)}.vcf`)
                    .catch(emailError => log.error(`Background VCF email send failed for user ${userId}:`, emailError));

                // Set headers for VCF download (original behavior)
                res.setHeader('Content-Type', 'text/vcard');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
                res.setHeader('Content-Length', Buffer.byteLength(cachedResult, 'utf8'));
                res.status(200).send(cachedResult);
                return;
            }

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


            console.log('Filter: ', extractedFilters)
            // Add the requirement that contacts must have an active subscription
            const finalFilters: ContactSearchFilters = {
                ...extractedFilters
            };

            this.log.info(`Exporting contacts for user ${userId} with filters: ${JSON.stringify(finalFilters)}`);

            const allContacts: Partial<IUser>[] = [];
            await this.userService.findAllUsersByCriteriaInBatches(
                finalFilters,
                true, // Pass the flag here for active subscriptions
                500,  // Example batch size, can be configured
                async (batch) => {
                    allContacts.push(...batch);
                }
            );

            this.log.info(`Found ${allContacts.length} contacts to export for user ${userId}`);

            if (allContacts.length === 0) {
                // ASYNC: Send an email even if no contacts were found, indicating an empty file.
                this.userService.sendContactsVcfEmail(userId, userEmail, '', `SBC_filtered_contacts_${new Date().toISOString().slice(0, 10)}.vcf`)
                    .catch(emailError => log.error(`Background VCF email send failed for user ${userId} (empty result):`, emailError));

                res.setHeader('Content-Type', 'text/vcard');
                res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
                res.status(200).send('');
                return;
            }

            // Generate VCF string
            let vcfString = '';
            const filtersApplied = req.query;

            for (const userContact of allContacts) {
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

            // Cache the result for popular filter combinations
            try {
                await popularFiltersCacheService.cacheResult(extractedFilters, vcfString, allContacts.length);
            } catch (cacheError: any) {
                this.log.warn('Failed to cache filter result:', cacheError);
            }

            // ASYNC: Send the VCF file as an email attachment in the background
            this.userService.sendContactsVcfEmail(userId, userEmail, vcfString, `SBC_filtered_contacts_${new Date().toISOString().slice(0, 10)}.vcf`)
                .catch(emailError => log.error(`Background VCF email send failed for user ${userId}:`, emailError));

            // Set headers for VCF download (original behavior)
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
            res.setHeader('Content-Length', Buffer.byteLength(vcfString, 'utf8'));
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
            const referrers = await this.userService.getReferrerIds(userId);
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
            const userIds = await this.userService.findUserIdsByCriteria(criteria, MAX_RESULTS);

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
            const allowedFilters = ['country', 'page', 'limit', 'startDate', 'endDate', 'name', 'search']; // Base allowed for CLASSIQUE + pagination
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
            const result = await this.userService.findUsersByCriteria(finalFilters, pagination);

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
        if (query.sex && Object.values(UserSex).includes(query.sex.toLowerCase() as UserSex)) filters.sex = query.sex.toLowerCase() as UserSex;
        if (query.language) filters.language = query.language as string;
        if (query.profession) filters.profession = query.profession as string;
        // Handle interests which can be a single value or an array
        if (query.interests) {
            filters.interests = Array.isArray(query.interests) ? query.interests : [query.interests];
        }
        if (query.name) filters.name = query.name as string;
        if (query.search) filters.name = query.search as string;

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
            const usersDetails = await this.userService.getUsersByIds(userIds);

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
            const userIds = await this.userService.findUserIdsBySearchTerm(searchTerm.trim());
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
            const updatedUser = await this.userService.updateAvatar(
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
            const { stream, contentType } = await this.userService.getAvatarStream(fileId);

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

            const profile = await this.userService.getPublicUserProfile(userId);

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
            await this.userService.resendOtp(email, purpose);

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
            if (!email) {
                throw new AppError('Email is required for password reset OTP.', 400);
            }
            await this.userService.requestPasswordResetOtp(email);
            res.status(200).json({ success: true, message: 'If your email is registered, a password reset OTP has been sent.' });
        } catch (error) {
            next(error);
        }
    }

    /**
     * @route POST /users/verify-password-reset-otp
     * @description Verifies the password reset OTP and returns a temporary password reset token.
     * @access Public
     */
    async verifyPasswordResetOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, otpCode } = req.body;
            if (!email || !otpCode) {
                throw new AppError('Email and OTP code are required.', 400);
            }

            const { passwordResetToken } = await this.userService.verifyPasswordResetOtpAndGenerateToken(email, otpCode);
            res.status(200).json({ success: true, message: 'OTP verified. Use the provided token to reset your password.', data: { passwordResetToken } });
        } catch (error) {
            next(error);
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

            await this.userService.requestChangeEmailOtp(userId, newEmail);

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
     * @route POST /users/reset-password
     * @description Resets the user's password using either OTP or a temporary password reset token.
     * @access Public
     */
    async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, otpCode, passwordResetToken, newPassword } = req.body;

            if (!email || !newPassword) {
                throw new AppError('Email and new password are required.', 400);
            }
            if (!otpCode && !passwordResetToken) {
                throw new AppError('Either OTP code or password reset token is required.', 400);
            }

            await this.userService.resetPassword(email, newPassword, otpCode, passwordResetToken);
            res.status(200).json({ success: true, message: 'Password has been reset successfully.' });
        } catch (error) {
            next(error);
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

            await this.userService.confirmChangeEmail(userId, newEmail, otpCode);

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

    /**
     * Check user existence
     * @route POST /api/users/check-existence
     */
    async checkExistence(req: Request, res: Response): Promise<void> {
        try {
            const { email, phoneNumber } = req.body;

            // Validate input
            if (!email && !phoneNumber) {
                res.status(400).json({ success: false, message: 'Either email or phoneNumber must be provided' });
                return;
            }

            // Call the service method
            const exists = await this.userService.checkExistence(email, phoneNumber);

            res.status(200).json({ success: true, data: { exists } });
        } catch (error: any) {
            log.error(`Error checking user existence: ${error.message}`);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * [ADMIN] Fixes referral hierarchy for specified users and retroactively distributes commissions.
     * This is a sensitive operation and should be restricted to ADMINs.
     * @route POST /api/users/admin/fix-referrals
     * @access Admin Only
     */
    async adminFixReferrals(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // Ensure only admins can access this endpoint
            if (!req.user || req.user.role !== UserRole.ADMIN) {
                res.status(403).json({ success: false, message: 'Access Denied: Admin role required.' });
                return;
            }

            const { usersToFix, bugStartDate, bugEndDate } = req.body; // usersToFix is an array of { userIdentifier, correctReferrerIdentifier }

            if (!Array.isArray(usersToFix) || usersToFix.length === 0) {
                res.status(400).json({ success: false, message: '`usersToFix` (array of user-referrer pairs) is required.' });
                return;
            }

            // Optional: Validate individual entries in usersToFix array (e.g., both identifiers are strings)
            for (const entry of usersToFix) {
                if (typeof entry.userIdentifier !== 'string' || typeof entry.correctReferrerIdentifier !== 'string') {
                    res.status(400).json({ success: false, message: 'Each `usersToFix` entry must contain `userIdentifier` and `correctReferrerIdentifier` as strings.' });
                    return;
                }
            }

            let parsedBugStartDate: Date | undefined;
            if (bugStartDate) {
                parsedBugStartDate = new Date(bugStartDate);
                if (isNaN(parsedBugStartDate.getTime())) {
                    res.status(400).json({ success: false, message: 'Invalid `bugStartDate` format.' });
                    return;
                }
            }

            let parsedBugEndDate: Date | undefined;
            if (bugEndDate) {
                parsedBugEndDate = new Date(bugEndDate);
                if (isNaN(parsedBugEndDate.getTime())) {
                    res.status(400).json({ success: false, message: 'Invalid `bugEndDate` format.' });
                    return;
                }
                // Make end date inclusive of the entire day
                parsedBugEndDate.setHours(23, 59, 59, 999);
            }


            log.info(`Admin ${req.user.userId} calling fixReferralAndCommissions with ${usersToFix.length} entries.`);
            const result = await this.userService.fixReferralAndCommissions(
                usersToFix,
                parsedBugStartDate,
                parsedBugEndDate,
                req.user.userId // Pass admin's ID for logging/auditing
            );

            res.status(200).json(result);

        } catch (error: any) {
            log.error(`[Controller] Error in adminFixReferrals:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                res.status(500).json({ success: false, message: 'An internal error occurred during the referral fix operation.' });
            }
        }
    }

    // NEW: Get User Active Subscriptions (Internal Route)
    async getUserActiveSubscriptions(req: Request, res: Response): Promise<void> {
        const { userId } = req.params;
        try {
            if (!userId) {
                res.status(400).json({ success: false, message: 'User ID is required.' });
                return;
            }
            const activeSubscriptions = await this.userService.getUserSubscriptionInfo(userId);
            res.status(200).json({ success: true, data: activeSubscriptions });
        } catch (error: any) {
            this.log.error(`Error getting active subscriptions for user ${userId}:`, error);
            res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to retrieve active subscriptions.' });
        }
    }

}

// Export singleton instance
export const userController = new UserController();