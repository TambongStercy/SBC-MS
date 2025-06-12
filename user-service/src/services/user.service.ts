import bcrypt from 'bcrypt';
import { IUser, UserRole } from '../database/models/user.model';
import { userRepository } from '../database/repositories/user.repository';
import { PopulatedReferredUserInfo, referralRepository, ReferralStatsResponse } from '../database/repositories/referral.repository';
import { signToken } from '../utils/jwt';
import { generateReferralCode } from '../utils/referral.utils';
import { Types, FilterQuery, FlattenMaps } from 'mongoose';
import { generateSecureOTP, getOtpExpiration } from '../utils/otp.utils';
import { notificationService, DeliveryChannel } from './clients/notification.service.client';
import logger from '../utils/logger';
import config from '../config';
import { dailyWithdrawalRepository } from '../database/repositories/daily-withdrawal.repository';
import SubscriptionModel, { SubscriptionType, SubscriptionStatus, ISubscription } from '../database/models/subscription.model';
import UserModel from '../database/models/user.model';
import { subscriptionService } from './subscription.service';
import { partnerService } from './partner.service';
import { subscriptionRepository } from '../database/repositories/subscription.repository';
import { ContactSearchFilters } from '../types/contact.types';
import { PaginationOptions } from '../types/express';
import { UserDetails } from '../database/repositories/user.repository';

// Import service clients
import { paymentService } from './clients/payment.service.client';
import { settingsService } from './clients/settings.service.client';
import { AppError } from '../utils/errors';
import { normalizePhoneNumber } from '../utils/phone.utils';

// Country Code to Prefix Mapping (for dashboard calculation)
const countryCodePrefixes: { [key: string]: string } = {
    CM: '237', BJ: '229', CG: '242', GH: '233',
    DZ: '213', AO: '244', BW: '267', BF: '226', BI: '257', CV: '238',
    CF: '236', TD: '235', KM: '269', CD: '243', CI: '225', DJ: '253',
    EG: '20', GQ: '240', ER: '291', SZ: '268', ET: '251', GA: '241',
    GM: '220', GN: '224', GW: '245', KE: '254', LS: '266',
    LR: '231', LY: '218', MG: '261', MW: '265', ML: '223', MR: '222',
    MU: '230', MA: '212', MZ: '258', NA: '264', NE: '227', NG: '234',
    RW: '250', ST: '239', SN: '221', SC: '248', SL: '232', SO: '252',
    ZA: '27', SS: '211', SD: '249', TZ: '255', TG: '228', TN: '216',
    UG: '256', ZM: '260', ZW: '263'
};

const defaultAffiliator = null;
const prefixToCountryCode: { [key: string]: string } = Object.entries(countryCodePrefixes)
    .reduce((acc, [code, prefix]) => {
        acc[prefix] = code;
        return acc;
    }, {} as { [key: string]: string });

// Interface for optional data during registration
interface IRegistrationData extends Partial<IUser> {
    referrerCode?: string; // Optional code from the user who referred this new user
    // interests and profession are now part of IUser, so implicitly allowed here
}

// Define the structure for referred user info (moved from referral.service.ts)
interface IReferredUserInfo {
    _id: Types.ObjectId;
    name: string;
    email: string;
    phoneNumber?: string; // Make phoneNumber optional
    referralLevel: number;
    createdAt: Date;
    activeSubscriptions?: SubscriptionType[]; // Added optional field
}

// Define interface specifically for populated referrer info (matching repository)
// NOTE: If PopulatedReferrerInfo was exported from repository, import it instead.
interface PopulatedReferrerInfo {
    _id: Types.ObjectId;
    name?: string;
    email?: string;
    phoneNumber?: number;
    region?: string;
    avatar?: string;
}

// Define criteria structure again (or import from a shared types location)
interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other';
    interests?: string[];
    professions?: string[];
}

// Create a component-specific logger
const log = logger.getLogger('UserService');

// Define the structure for monthly aggregated counts
interface MonthlyCount {
    month: string; // e.g., "2024-02"
    count: number;
}

// Interface for the dashboard response - UPDATED
interface AdminDashboardData {
    adminBalance: number;
    count: number; // Total Users
    subCount: number; // Total Active Subscribers
    // Removed raw date arrays:
    // allUsersDates: Date[];
    // classiqueSubStartDates: Date[];
    // cibleSubStartDates: Date[];
    // Added aggregated monthly data:
    monthlyAllUsers: MonthlyCount[];
    monthlyClassiqueSubs: MonthlyCount[];
    monthlyCibleSubs: MonthlyCount[];

    totalTransactions: number;
    totalWithdrawals: number;
    totalRevenue: number;
    monthlyRevenue: any[]; // Define specific type if known from paymentService
    balancesByCountry: { [countryCode: string]: number }; // Renamed from 'balances'
    activityOverview: any[]; // Define specific type if known from paymentService
}

// Define the extended user profile response
// Inherit from the OMITTED type to match mapUserToResponse
interface IUserProfileResponse extends Omit<IUser, 'password' | 'otps' | 'contactsOtps' | 'token'> {
    activeSubscriptions?: string[];
    totalBenefits?: number;
}

// Define the public user profile response (non-sensitive fields)
interface IPublicUserProfileResponse {
    _id: string | Types.ObjectId; // Keep ID
    name: string;
    email: string;
    avatar?: string;
    phoneNumber?: string;
    country?: string;
    region?: string;
    city?: string;
    sex?: string;
    birthDate?: Date;
    language?: string[];
    interests?: string[];
    profession?: string;
    createdAt?: Date;
    // Add other fields considered safe for public view
}

export class UserService {
    private subscriptionRepository = subscriptionRepository; // Inject repository

    private isValidEmailDomain(email: string) {
        const emailRegex = /@(gmail|outlook|hotmail|yahoo|icloud|aol|protonmail|zoho|mail|gmx|yandex|fastmail|tutanota|me|mac|live|msn)\.(com|net|org|ru|de|uk|fr|ca|au|in|it|es|br)$/i;
        return config.nodeEnv === 'development' ? true : emailRegex.test(email);
    }

    // Register a new user - MODIFIED FOR 2FA
    async registerUser(
        registrationData: IRegistrationData,
        ipAddress?: string
        // No longer returns token directly
    ): Promise<{ message: string; userId: string }> {
        const { referrerCode, ...userData } = registrationData;
        console.log("referrerCode", referrerCode);
        console.log("userData", userData);

        if (!userData.email || !userData.password || !userData.name || !userData.sex || !userData.birthDate || !userData.country || !userData.region || !userData.phoneNumber) {
            throw new Error('Missing required registration fields');
        }

        if (!this.isValidEmailDomain(userData.email)) {
            throw new Error('Invalid email domain');
        }

        // Optional validation for new fields (can be enhanced)
        if (userData.interests && !Array.isArray(userData.interests)) {
            throw new Error('Interests must be an array of strings.');
        }
        if (userData.profession && typeof userData.profession !== 'string') {
            throw new Error('Profession must be a string.');
        }

        // 1. Check for duplicates
        const existingUser = await userRepository.findByEmailOrPhone(userData.email, userData.phoneNumber);
        if (existingUser) {
            throw new Error('User with this email or phone number already exists');
        }

        // 2. Find Referrer User (if code provided)
        let referrer: IUser | null = null;
        if (referrerCode) {
            referrer = await userRepository.findByReferralCode(referrerCode);
            if (!referrer) {
                // Decide policy: reject registration or allow without referral?
                // For now, let's throw an error.
                throw new Error('Invalid referrer code provided');
            }
            // Optional: Check if referrer is allowed to refer (e.g., not blocked)
            if (referrer.blocked) { throw new Error('Referrer is blocked'); }
            console.log("referrer", referrer);
        } else if (defaultAffiliator) {
            console.log(`Using default affiliator: ${defaultAffiliator}`);
            referrer = await userRepository.findById(defaultAffiliator);
        }


        // 3. Generate a unique referral code for the new user
        let uniqueReferralCode = generateReferralCode();
        let codeExists = await userRepository.findByReferralCode(uniqueReferralCode);
        while (codeExists) { // Ensure uniqueness (highly unlikely collision with nanoid, but good practice)
            uniqueReferralCode = generateReferralCode();
            codeExists = await userRepository.findByReferralCode(uniqueReferralCode);
        }
        userData.referralCode = uniqueReferralCode;

        // 4. Create the new user via repository
        const newUser = await userRepository.create(userData);

        // 5. Create referral hierarchy if referrer exists
        if (referrer) {
            await this.createReferralHierarchy(referrer, newUser);
        }

        // --- Update IP Address --- 
        if (ipAddress) {
            try {
                // Don't wait for this, let it run in background
                userRepository.updateIpAddress(newUser._id, { ipAddress });
            } catch (ipError) {
                log.error(`Failed to update IP on registration for ${newUser.email}`, ipError);
            }
        }
        // --- End IP Update --- 

        // --- Trigger OTP Generation --- 
        try {
            const otp = await this.generateAndStoreOtp(newUser._id, 'otps'); // Use general OTP type
            // this notification service communicates with the notification microservice
            await notificationService.sendOtp({
                userId: newUser._id.toString(),
                recipient: newUser.email,
                channel: DeliveryChannel.EMAIL,
                code: otp,
                expireMinutes: 10,
                isRegistration: true,
                userName: newUser.name
            });
        } catch (otpError) {
            log.error(`Failed to generate OTP during registration for ${newUser.email}`, otpError);
            // If OTP fails, maybe roll back user creation or mark them as needing verification?
            // For now, throw an error to indicate registration couldn't fully complete.
            throw new Error('Registration succeeded but failed to send verification code.');
        }
        // --- End OTP Generation --- 

        // Don't generate JWT here anymore.
        // Return success message and userId to indicate OTP step is next.
        return {
            message: 'Registration successful. Please verify your account with the OTP sent.',
            userId: newUser._id.toString()
        };
    }

    /**
     * Creates the referral links (level 1, 2, 3) for a new user.
     * @param directReferrer - The user document of the direct referrer (Level 1).
     * @param referredUser - The user document of the newly registered user.
     */
    private async createReferralHierarchy(directReferrer: IUser, referredUser: IUser): Promise<void> {
        try {
            const referralsToCreate: { referrer: Types.ObjectId; referredUser: Types.ObjectId; referralLevel: number }[] = [];

            // Level 1: Direct referrer
            referralsToCreate.push({
                referrer: directReferrer._id,
                referredUser: referredUser._id,
                referralLevel: 1,
            });

            // Level 2: Referrer of the direct referrer
            const level2ReferrerUser = await referralRepository.findDirectReferrerPopulated(directReferrer._id);
            // Ensure referrer exists and has an ID before proceeding
            if (level2ReferrerUser && level2ReferrerUser._id) { // Check for user AND _id
                const level2ReferrerId = level2ReferrerUser._id; // Now definitely ObjectId
                referralsToCreate.push({
                    referrer: level2ReferrerId,
                    referredUser: referredUser._id,
                    referralLevel: 2,
                });

                // Level 3: Referrer of the level 2 referrer
                // Pass the validated level2ReferrerId here
                const level3ReferrerUser = await referralRepository.findDirectReferrerPopulated(level2ReferrerId);
                // Ensure referrer exists and has an ID
                if (level3ReferrerUser && level3ReferrerUser._id) { // Check for user AND _id
                    const level3ReferrerId = level3ReferrerUser._id; // Now definitely ObjectId
                    referralsToCreate.push({
                        referrer: level3ReferrerId,
                        referredUser: referredUser._id,
                        referralLevel: 3,
                    });
                }
            }

            if (referralsToCreate.length > 0) {
                await referralRepository.createMany(referralsToCreate);
                log.info(`Created ${referralsToCreate.length} referral links for user ${referredUser.email}`);
            }
        } catch (error: any) {
            // Log the error but don't block registration if referral creation fails
            log.error(`Failed to create referral hierarchy for user ${referredUser.email}: ${error.message}`);
        }
    }

    // Login user - MODIFIED FOR 2FA
    async loginUser(
        email: string,
        passwordAttempt: string,
        ipAddress?: string
        // No longer returns token directly
    ): Promise<{ message: string; userId: string }> {
        if (!email || !passwordAttempt) { throw new Error('Email and password are required'); }

        const user = await userRepository.findByEmail(email, true);
        if (!user || !user.password) { throw new Error('Invalid email or password'); }

        const isMatch = await bcrypt.compare(passwordAttempt, user.password);
        if (!isMatch) { throw new Error('Invalid email or password'); }

        if (user.blocked) { throw new Error('User account is blocked'); }

        // Update IP Address (async)
        if (ipAddress && ipAddress !== user.ipAddress) { /* ... IP update logic ... */ }

        // --- Trigger OTP Generation --- 
        try {
            const otp = await this.generateAndStoreOtp(user._id, 'otps'); // Use general OTP type

            // Send OTP to user
            await notificationService.sendOtp({
                userId: user._id.toString(),
                recipient: user.email,
                channel: DeliveryChannel.EMAIL,
                code: otp,
                expireMinutes: 10,
                isRegistration: false,
                userName: user.name
            });
        } catch (otpError) {
            log.error(`Failed to generate OTP during login for ${user.email}`, otpError);
            throw new Error('Login failed: Could not send OTP verification code.');
        }
        // --- End OTP Generation --- 

        // Don't generate/store JWT here.
        // Return message and userId for the verification step.
        return {
            message: 'Password verified. Please enter the OTP sent to complete login.',
            userId: user._id.toString()
        };
    }

    /**
     * Retrieves a user profile, removing sensitive information.
     * Appends active subscription types, total benefits, and partner pack.
     * @param userId The ID of the user to retrieve.
     * @returns User profile or null if not found.
     */
    async getUserProfile(userId: string): Promise<(IUserProfileResponse & { partnerPack?: 'silver' | 'gold' }) | null> {
        log.info(`Getting profile for user ${userId}`);
        const user = await userRepository.findById(userId);

        if (!user || user.deleted) {
            log.warn(`User profile not found or deleted for ID: ${userId}`);
            return null;
        }

        // Map basic user info, excluding sensitive fields
        const userResponse = this.mapUserToResponse(user);
        log.debug(`Mapped basic profile for user ${userId}`);

        // Fetch additional data in parallel
        try {
            log.info(`Fetching additional profile data (subscriptions, benefits, partner status) for user ${userId}`);
            const userObjectId = new Types.ObjectId(userId);
            const [activeSubscriptions, totalBenefits, activePartner] = await Promise.all([
                subscriptionService.getActiveSubscriptionTypes(userObjectId.toString()),
                paymentService.getUserTotalWithdrawals(userObjectId.toString()), // Call the new client method
                partnerService.getActivePartnerByUserId(userObjectId.toString()) // Fetch partner status
            ]);
            log.info(`Fetched active subscriptions (${activeSubscriptions.length}), total benefits (${totalBenefits}) for user ${userId}`);
            if (activePartner) {
                log.info(`User ${userId} is an active partner with pack: ${activePartner.pack}.`);
            }

            const extendedResponse: IUserProfileResponse & { partnerPack?: 'silver' | 'gold' } = {
                ...userResponse,
                activeSubscriptions: activeSubscriptions.length > 0 ? activeSubscriptions as string[] : undefined,
                totalBenefits: totalBenefits,
                partnerPack: activePartner ? activePartner.pack : undefined // Add partnerPack
            };

            return extendedResponse;

        } catch (error) {
            log.error(`Error fetching additional profile data for user ${userId}:`, error);
            // Return basic profile even if fetching additional data fails, but mark additional fields as undefined
            return {
                ...userResponse,
                activeSubscriptions: undefined, // Indicate data is missing due to error
                totalBenefits: undefined       // Indicate data is missing due to error
            };
        }
    }

    /**
     * Helper to map IUser document or plain object to a safe response object.
     * Excludes sensitive fields.
     * Handles both Mongoose documents and plain objects (from .lean()).
     */
    private mapUserToResponse(user: IUser | FlattenMaps<IUser>): Omit<IUser, 'password' | 'otps' | 'contactsOtps' | 'token'> {
        // If it has .toObject, it's a Mongoose document
        const userObject = typeof (user as IUser).toObject === 'function' ? (user as IUser).toObject() : { ...user };
        delete userObject.password;
        delete userObject.otps;
        delete userObject.contactsOtps;
        delete userObject.token;
        // Ensure all fields of IUser are present if using spread operator (might need explicit mapping for safety)
        return userObject as Omit<IUser, 'password' | 'otps' | 'contactsOtps' | 'token'>;
    }

    /**
     * Generates and stores an OTP for a user.
     * @param userId - The ID of the user.
     * @param otpType - 'otps' or 'contactsOtps'.
     * @param minutesToExpire - How long the OTP should be valid for.
     * @returns The generated OTP code.
     */
    async generateAndStoreOtp(
        userId: string | Types.ObjectId,
        otpType: 'otps' | 'contactsOtps',
        minutesToExpire = 10
    ): Promise<string> {
        const user = await userRepository.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Consider limiting the number of OTPs stored per type if needed

        const otpCode = generateSecureOTP(); // Generate 6-digit OTP
        const expiration = getOtpExpiration(minutesToExpire);

        await userRepository.addOtp(userId, otpType, { code: otpCode, expiration });

        // For debugging only - remove in production
        log.info(`Generated OTP ${otpCode} for user ${user.email}, type: ${otpType}`);

        return otpCode;
    }

    /**
     * Validates an OTP provided by a user.
     * If successful and otpType is 'otps' (general), generates and stores a new JWT.
     * Clears OTPs of the specified type upon successful validation.
     * @param userId - The ID of the user.
     * @param otpType - 'otps' or 'contactsOtps'.
     * @param providedCode - The OTP code entered by the user.
     * @returns True if validation is successful, false otherwise.
     */
    async validateOtp(
        userId: string | Types.ObjectId,
        otpType: 'otps' | 'contactsOtps',
        providedCode: string
    ): Promise<{ isValid: boolean; newToken?: string }> { // Return new token if applicable
        const user = await userRepository.findById(userId);

        if (!user) {
            log.warn(`OTP validation failed - User not found: ${userId}`);
            return { isValid: false };
        }

        const otps = user[otpType];
        if (!otps || otps.length === 0) {
            log.warn(`OTP validation failed - No OTPs found for user: ${user.email}, type: ${otpType}`);
            return { isValid: false };
        }

        const now = new Date();
        let isValid = false;
        let newToken: string | undefined = undefined;

        const matchingOtp = otps.find(otp => {
            return otp.code === providedCode && otp.expiration > now;
        });

        if (matchingOtp) {
            isValid = true;
            log.info(`OTP ${providedCode} validated successfully for user ${user.email}, type: ${otpType}`);

            // Clear OTPs first
            await userRepository.clearOtps(userId, otpType);

            // --- Generate and Store New Token if General OTP --- 
            if (otpType === 'otps') {
                const tokenPayload = { userId: user._id, id: user._id, email: user.email, role: user.role };
                newToken = signToken(tokenPayload);
                try {
                    await userRepository.updateById(user._id, { token: newToken, isVerified: true }); // Mark as verified too
                    log.info(`New token generated and stored for user ${user.email} after OTP validation.`);
                } catch (tokenStoreError) {
                    log.error(`Failed to store new token for user ${user.email} after OTP validation:`, tokenStoreError);
                    // If token storing fails, maybe invalidate the OTP success?
                    // For now, log and continue, but the user might have issues later.
                }
            }
            // --- End Token Generation ---

        } else {
            log.warn(`OTP validation failed for user ${user.email}, type: ${otpType}. Code: ${providedCode}`);
            // Optional: Implement attempt limiting logic here
        }

        // Clear expired OTPs (could also be a separate background job)
        await userRepository.clearExpiredOtps(userId);

        return { isValid, newToken }; // Return validation status and new token
    }

    /**
     * Clears the stored token for a user (logout).
     * @param userId - The ID of the user.
     */
    async logoutUser(userId: string | Types.ObjectId): Promise<void> {
        try {
            await userRepository.updateById(userId, { token: undefined });
            log.info(`User ${userId} logged out`);
        } catch (error) {
            log.error(`Error logging out user ${userId}`, error);
            throw error;
        }
    }

    // --- User Profile Management ---

    /**
     * Updates allowed user profile fields.
     * @param userId - The ID of the user to update.
     * @param updateData - Fields to update (only allowed fields).
     * @returns Updated user profile or null.
     */
    async updateUserProfile(
        userId: string | Types.ObjectId,
        // Add referralCode to Pick
        updateData: Partial<Pick<IUser,
            'name' | 'region' | 'country' | 'city' | 'phoneNumber' | 'momoNumber' |
            'momoOperator' | 'avatar' | 'avatarId' | 'sex' | 'birthDate' | 'language' |
            'preferenceCategories' | 'interests' | 'profession' | 'shareContactInfo' |
            'referralCode' // Added referralCode here
        >>
    ): Promise<Omit<IUser, 'password' | 'otps' | 'contactsOtps'> | null> {
        // Only allow specific fields to be updated by the user
        const allowedFields: Partial<IUser> = {};

        if (updateData.name !== undefined) allowedFields.name = updateData.name;
        if (updateData.region !== undefined) allowedFields.region = updateData.region;
        if (updateData.country !== undefined) allowedFields.country = updateData.country;
        if (updateData.city !== undefined) allowedFields.city = updateData.city;
        if (updateData.phoneNumber !== undefined) allowedFields.phoneNumber = updateData.phoneNumber;
        if (updateData.momoNumber !== undefined) allowedFields.momoNumber = updateData.momoNumber;
        if (updateData.momoOperator !== undefined) allowedFields.momoOperator = updateData.momoOperator;
        if (updateData.avatar !== undefined) allowedFields.avatar = updateData.avatar;
        if (updateData.avatarId !== undefined) allowedFields.avatarId = updateData.avatarId;
        if (updateData.sex !== undefined) allowedFields.sex = updateData.sex;
        if (updateData.birthDate !== undefined) allowedFields.birthDate = updateData.birthDate;
        if (updateData.language !== undefined) allowedFields.language = updateData.language;
        if (updateData.preferenceCategories !== undefined) allowedFields.preferenceCategories = updateData.preferenceCategories;
        if (updateData.interests !== undefined) allowedFields.interests = updateData.interests;
        if (updateData.profession !== undefined) allowedFields.profession = updateData.profession;
        if (updateData.shareContactInfo !== undefined) allowedFields.shareContactInfo = updateData.shareContactInfo;
        if (updateData.referralCode !== undefined) allowedFields.referralCode = updateData.referralCode; // Add referral code assignment

        // --- Referral Code Uniqueness Check --- 
        if (allowedFields.referralCode) {
            const codeToCheck = allowedFields.referralCode.toLowerCase(); // Explicitly lowercase here
            // Basic validation: check length, characters if needed (e.g., alphanumeric)
            if (typeof codeToCheck !== 'string' || codeToCheck.length < 4) { // Example: min length 4
                throw new AppError('Referral code must be at least 4 characters long.', 400);
            }
            // Check if the code is already taken by ANOTHER user
            const existingUserWithCode = await userRepository.findByReferralCode(codeToCheck); // Pass lowercased code
            if (existingUserWithCode && existingUserWithCode._id.toString() !== userId.toString()) {
                log.warn(`User ${userId} attempted to update referral code to ${codeToCheck}, but it's already taken by user ${existingUserWithCode._id}`);
                throw new AppError('Referral code is already in use by another user.', 409); // 409 Conflict
            }
            log.info(`Referral code ${codeToCheck} is available for user ${userId}.`);
            allowedFields.referralCode = codeToCheck; // Ensure the lowercase version is what gets saved
        }
        // --- End Referral Code Check --- 

        // Skip update if no allowed fields are being modified (after potential referral code validation)
        if (Object.keys(allowedFields).length === 0) {
            const user = await userRepository.findById(userId);
            return user ? this.mapUserToResponse(user) : null;
        }

        const updatedUser = await userRepository.updateById(userId, allowedFields);
        return updatedUser ? this.mapUserToResponse(updatedUser) : null;
    }

    // --- Soft Delete Management ---

    /**
     * Soft deletes a user account.
     * @param userId - The ID of the user to delete.
     * @param reason - Optional reason for deletion.
     * @returns Success status.
     */
    async softDeleteUser(userId: string | Types.ObjectId, reason?: string): Promise<boolean> {
        try {
            await userRepository.softDeleteById(userId, reason);
            return true;
        } catch (error) {
            log.error(`Error soft-deleting user ${userId}`, error);
            throw error;
        }
    }

    /**
     * Restores a soft-deleted user account.
     * @param userId - The ID of the user to restore.
     * @returns Success status.
     */
    async restoreUser(userId: string | Types.ObjectId): Promise<boolean> {
        try {
            await userRepository.restoreById(userId);
            return true;
        } catch (error) {
            log.error(`Error restoring user ${userId}`, error);
            throw error;
        }
    }

    // --- Balance and Withdrawal Management ---

    /**
     * Updates a user's balance.
     * @param userId - The ID of the user.
     * @param amount - Amount to add (positive) or subtract (negative).
     * @returns Updated balance or null if user not found.
     */
    async updateBalance(userId: string | Types.ObjectId, amount: number): Promise<number | null> {
        try {
            const user = await userRepository.updateBalance(userId, amount);
            return user ? user.balance : null;
        } catch (error) {
            log.error(`Error updating balance for user ${userId}`, error);
            throw error;
        }
    }

    /**
     * Records a withdrawal in the user's daily withdrawal history.
     * @param userId - The ID of the user.
     * @param amount - The withdrawal amount.
     * @param dateString - Optional date string (YYYY-MM-DD), defaults to today.
     * @returns Success status.
     */
    async recordWithdrawal(
        userId: string | Types.ObjectId,
        amount: number,
        dateString?: string
    ): Promise<boolean> {
        try {
            // Create a Date object from the date string or use today
            const date = dateString ? new Date(dateString) : new Date();

            // Create or update the withdrawal record in the repository
            await dailyWithdrawalRepository.createDailyWithdrawal({
                userId: new Types.ObjectId(userId.toString()),
                date,
                count: 1,
                totalAmount: amount
            });

            // Update user balance
            await this.updateBalance(userId, -amount);

            return true;
        } catch (error) {
            log.error(`Error recording withdrawal for user ${userId}`, error);
            throw error;
        }
    }

    /**
     * Gets daily withdrawal data for a specific date.
     * @param userId - The ID of the user.
     * @param dateString - The date string (YYYY-MM-DD).
     * @returns Withdrawal data for the date or null.
     */
    async getDailyWithdrawalStats(
        userId: string | Types.ObjectId,
        dateString: string
    ): Promise<{ count: number; totalAmount: number } | null> {
        try {
            // Convert string date to Date object for repository method
            const date = new Date(dateString);
            const withdrawalRecord = await dailyWithdrawalRepository.getDailyWithdrawalByUserAndDate(userId, date);
            return withdrawalRecord
                ? { count: withdrawalRecord.count, totalAmount: withdrawalRecord.totalAmount }
                : { count: 0, totalAmount: 0 };
        } catch (error) {
            log.error(`Error getting withdrawal stats for user ${userId}`, error);
            throw error;
        }
    }

    // --- Referral Management (moved from referral.service.ts) ---

    /**
     * Gets the direct referrer (affiliator) of a given user.
     * @param userId - The ID of the user whose referrer is needed.
     * @returns The populated referrer user document (subset of fields) or null.
     */
    async getAffiliator(userId: string | Types.ObjectId): Promise<PopulatedReferrerInfo | null> {
        try {
            // Use the new populated method directly
            const referrerUser = await referralRepository.findDirectReferrerPopulated(userId);
            // The method already returns the populated user (PopulatedReferrerInfo) or null
            return referrerUser;
        } catch (error) {
            log.error(`Error getting affiliator for user ${userId}`, error);
            throw error;
        }
    }

    /**
     * Gets user information by affiliation code
     * @param referralCode - The affiliation code
     * @returns The user document or null if not found
     */
    async getUserByReferralCode(referralCode: string): Promise<Partial<IUser> | null> {
        try {
            const user = await userRepository.findByReferralCode(referralCode);
            return user ? this.mapUserToResponse(user) : null;
        } catch (error) {
            log.error(`Error getting user by referral code ${referralCode}`, error);
            throw error;
        }
    }


    /**
     * Gets a list of users referred by a specific user, optionally filtered by level and name.
     * Includes active subscription types for each referred user.
     * @param referrerId - The ID of the user whose referrals are needed.
     * @param level - Optional referral level (1, 2, or 3).
     * @param nameFilter - Optional name fragment to filter referred users (case-insensitive).
     * @param page - Page number for pagination (default: 1).
     * @param limit - Items per page (default: 10).
     * @param subType - Optional subType filter ('none', 'all', 'CLASSIQUE', 'CIBLE').
     */
    async getReferredUsersInfoPaginated( // <<< ADDED METHOD NAME HERE
        referrerId: string | Types.ObjectId,
        level?: number, // Optional
        nameFilter?: string, // Optional
        page: number = 1,
        limit: number = 10,
        subType?: string // NEW PARAMETER
    ): Promise<{ // Return type updated
        referredUsers: IReferredUserInfo[];
        totalCount: number;
        totalPages: number;
        page: number;
    }> {
        try {
            let referredUsersData: PopulatedReferredUserInfo[] = [];
            let totalCount = 0;
            const referrerObjectId = new Types.ObjectId(referrerId.toString());

            // 1. Fetch referrals (filtered or unfiltered)
            if (nameFilter && nameFilter.trim().length > 0) {
                // Use new search methods if nameFilter is provided
                log.info(`Searching referred users for ${referrerId} with name filter: ${nameFilter}`);
                const searchResult = level && [1, 2, 3].includes(level)
                    ? await referralRepository.searchReferralsByReferrerAndLevel(referrerObjectId, level, nameFilter, page, limit)
                    : await referralRepository.searchAllReferralsByReferrer(referrerObjectId, nameFilter, page, limit);
                referredUsersData = searchResult.referrals;
                totalCount = searchResult.totalCount;
            } else {
                // Use existing methods if no nameFilter
                log.info(`Fetching referred users for ${referrerId} (no name filter)`);
                const referralResponse = level && [1, 2, 3].includes(level)
                    ? await referralRepository.findReferralsByReferrerAndLevel(referrerObjectId, level, page, limit, true)
                    : await referralRepository.findAllReferralsByReferrer(referrerObjectId, page, limit, true);
                // Map the populated data to the expected structure
                referredUsersData = referralResponse.referrals.map((ref: any) => {
                    const user = ref.referredUser;
                    return {
                        _id: user._id,
                        name: user?.name ?? 'N/A',
                        email: user?.email ?? 'N/A',
                        phoneNumber: user?.phoneNumber?.toString() ?? '', // Ensure string
                        referralLevel: ref.referralLevel,
                        avatar: user?.avatar ?? '',
                        avatarId: user?.avatarId ?? '',
                        createdAt: ref.createdAt,
                        // activeSubscriptions will be added later
                    };
                }).filter((info: any) => info.name !== 'N/A');
                totalCount = referralResponse.totalCount;
            }

            if (!referredUsersData || referredUsersData.length === 0) {
                return {
                    referredUsers: [],
                    totalCount: 0,
                    totalPages: 0,
                    page
                };
            }

            // 2. Extract referred user IDs from the (potentially filtered) list
            const referredUserIds = referredUsersData.map(user => user._id);

            // 3. Fetch active subscriptions for these users (same as before)
            let activeSubscriptionsMap = new Map<string, SubscriptionType[]>();
            if (referredUserIds.length > 0) {
                const activeSubs = await this.subscriptionRepository.findActiveSubscriptionsForMultipleUsers(referredUserIds);
                activeSubs.forEach((sub: any) => {
                    const userIdStr = sub.user.toString();
                    if (!activeSubscriptionsMap.has(userIdStr)) {
                        activeSubscriptionsMap.set(userIdStr, []);
                    }
                    activeSubscriptionsMap.get(userIdStr)?.push(sub.subscriptionType);
                });
            }

            // 4. Map final data, adding subscription info
            let mappedUsers: IReferredUserInfo[] = referredUsersData.map((user) => {
                const userIdStr = user._id.toString();
                const subscriptions = activeSubscriptionsMap.get(userIdStr);
                return {
                    ...user,
                    activeSubscriptions: subscriptions && subscriptions.length > 0 ? subscriptions : undefined
                };
            });

            // 5. Apply subType filter AFTER mapping
            if (subType) {
                log.info(`Applying subType filter: ${subType}`);
                mappedUsers = mappedUsers.filter(user => {
                    if (subType === 'none') {
                        return !user.activeSubscriptions || user.activeSubscriptions.length === 0;
                    } else if (subType === 'all') {
                        return user.activeSubscriptions && user.activeSubscriptions.length > 0;
                    } else { // Specific type: 'CLASSIQUE' or 'CIBLE'
                        return user.activeSubscriptions?.includes(subType as SubscriptionType);
                    }
                });
            }

            // IMPORTANT: The totalCount and totalPages returned here reflect the UNFILTERED count from the
            // initial repository query. If the subType filter significantly reduces the results on a page,
            // 'referredUsers.length' might be less than 'limit', but 'totalCount' will remain the original total.
            // If you need totalCount/totalPages to reflect the *filtered* count, the filtering logic
            // would need to be integrated into the initial database query for referred users.

            // 6. Return combined data with pagination
            return {
                referredUsers: mappedUsers,
                totalCount: totalCount, // This is the total from the initial unfiltered query
                totalPages: Math.ceil(totalCount / limit), // This is based on unfiltered total
                page: page
            };
        } catch (error) {
            log.error(`Error getting referred users for user ${referrerId}`, error);
            throw error;
        }
    }


    /**
     * Gets detailed information about referrals with counts by level.
     * @param userId - The ID of the user whose referral stats are needed.
     * @returns Referral statistics.
     */
    async getReferralStats(userId: string | Types.ObjectId): Promise<ReferralStatsResponse> {
        try {
            // Get counts directly from repository using its dedicated stats method
            return await referralRepository.getReferralStats(userId);
        } catch (error) {
            log.error(`Error getting referral stats for user ${userId}`, error);
            throw error;
        }
    }

    // Add these 2FA methods to the UserService class
    /**
     * Generate and send OTP code for 2FA
     * @param userId User ID
     * @param email Email to send OTP to
     * @param isRegistration Whether this is for registration or login
     * @returns The generated OTP code or null if failed
     */
    async generateAndSendEmailOTP(userId: string | Types.ObjectId, email: string, isRegistration: boolean = false): Promise<string | null> {
        try {
            // Generate a 6-digit OTP code
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Get user name if available
            const user = await userRepository.findById(userId);
            if (!user) {
                log.error(`Failed to generate OTP: User ${userId} not found`);
                return null;
            }

            // Calculate expiration (10 minutes from now)
            const expiration = new Date();
            expiration.setMinutes(expiration.getMinutes() + 10);

            // Save OTP to user's document
            await userRepository.addOtp(userId, 'otps', { code: otpCode, expiration });

            // Send OTP via notification service
            const sent = await notificationService.send2FAEmail(
                userId.toString(),
                email,
                otpCode,
                user.name,
                isRegistration
            );

            if (!sent) {
                log.warn(`Email OTP generated but notification failed for user ${userId}`);
                // OTP is still valid even if notification failed
            } else {
                log.info(`Email OTP sent successfully to ${email}`);
            }

            return otpCode;
        } catch (error: any) {
            log.error(`Failed to generate and send email OTP: ${error.message}`, { userId, email });
            return null;
        }
    }

    /**
     * Generate and send OTP code via SMS for 2FA
     * @param userId User ID
     * @param phoneNumber Phone number to send OTP to
     * @param isRegistration Whether this is for registration or login
     * @returns The generated OTP code or null if failed
     */
    async generateAndSendSMSOTP(userId: string | Types.ObjectId, phoneNumber: string, isRegistration: boolean = false): Promise<string | null> {
        try {
            // Generate a 6-digit OTP code
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Get user name if available
            const user = await userRepository.findById(userId);
            if (!user) {
                log.error(`Failed to generate OTP: User ${userId} not found`);
                return null;
            }

            // Calculate expiration (10 minutes from now)
            const expiration = new Date();
            expiration.setMinutes(expiration.getMinutes() + 10);

            // Save OTP to user's document
            await userRepository.addOtp(userId, 'otps', { code: otpCode, expiration });

            // Format phone number if needed
            const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

            // Send OTP via notification service
            const sent = await notificationService.send2FASMS(
                userId.toString(),
                formattedPhone,
                otpCode,
                user.name,
                isRegistration
            );

            if (!sent) {
                log.warn(`SMS OTP generated but notification failed for user ${userId}`);
                // OTP is still valid even if notification failed
            } else {
                log.info(`SMS OTP sent successfully to ${formattedPhone}`);
            }

            return otpCode;
        } catch (error: any) {
            log.error(`Failed to generate and send SMS OTP: ${error.message}`, { userId, phoneNumber });
            return null;
        }
    }

    /**
     * Verify OTP code for 2FA
     * @param userId User ID
     * @param code OTP code to verify
     * @returns Whether the code is valid
     */
    async verifyOTP(userId: string | Types.ObjectId, code: string): Promise<boolean> {
        try {
            const user = await userRepository.findById(userId);
            if (!user) {
                log.error(`Failed to verify OTP: User ${userId} not found`);
                return false;
            }

            // Find matching OTP in user's OTPs
            const matchingOTP = user.otps.find((otp: any) =>
                otp.code === code && otp.expiration > new Date()
            );

            if (!matchingOTP) {
                log.warn(`Invalid or expired OTP provided for user ${userId}`);
                return false;
            }

            // Clear the OTPs after successful verification
            await userRepository.clearOtps(userId, 'otps');

            log.info(`OTP verified successfully for user ${userId}`);
            return true;
        } catch (error: any) {
            log.error(`Failed to verify OTP: ${error.message}`, { userId });
            return false;
        }
    }

    /**
     * Validates if a user exists and is not blocked or deleted
     * @param userId User ID to validate
     * @returns Whether the user is valid
     */
    async validateUser(userId: string | Types.ObjectId): Promise<boolean> {
        try {
            const user = await userRepository.findById(userId);
            return !!user && !user.blocked && !user.deleted;
        } catch (error: any) {
            log.error(`Error validating user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Checks if a withdrawal is allowed based on user limits
     * @param userId User ID
     * @param amount Amount to withdraw
     * @returns Whether the withdrawal is allowed and reason if not
     */
    async checkWithdrawalLimits(userId: string | Types.ObjectId, amount: number): Promise<{
        allowed: boolean;
        reason?: string;
        dailyLimit?: number;
        dailyRemaining?: number;
    }> {
        try {
            const user = await userRepository.findById(userId);

            // Check if user exists
            if (!user) {
                return { allowed: false, reason: 'User not found' };
            }

            // Check if user is blocked or deleted
            if (user.blocked || user.deleted) {
                return { allowed: false, reason: 'Account is blocked or deleted' };
            }

            // Check if amount is positive
            if (amount <= 0) {
                return { allowed: false, reason: 'Amount must be greater than zero' };
            }

            // Check if user has sufficient balance
            if (user.balance < amount) {
                return { allowed: false, reason: 'Insufficient balance' };
            }

            // Get daily withdrawal limit from config
            const dailyWithdrawalLimit = config.withdrawal?.dailyLimit || 50000;

            // Get today's date
            const today = new Date();

            // Get daily withdrawal data for today
            const todayWithdrawals = await dailyWithdrawalRepository.getDailyWithdrawalByUserAndDate(userId, today);

            // Calculate today's total withdrawal amount
            const todayTotalAmount = todayWithdrawals?.totalAmount || 0;

            // Check if this withdrawal would exceed daily limit
            if (todayTotalAmount + amount > dailyWithdrawalLimit) {
                const remaining = Math.max(0, dailyWithdrawalLimit - todayTotalAmount);
                return {
                    allowed: false,
                    reason: `Daily withdrawal limit exceeded`,
                    dailyLimit: dailyWithdrawalLimit,
                    dailyRemaining: remaining
                };
            }

            // All checks passed
            return {
                allowed: true,
                dailyLimit: dailyWithdrawalLimit,
                dailyRemaining: dailyWithdrawalLimit - (todayTotalAmount + amount)
            };
        } catch (error: any) {
            log.error(`Error checking withdrawal limits for user ${userId}:`, error);
            return { allowed: false, reason: 'Error checking withdrawal limits' };
        }
    }

    /**
     * Gets the IDs of the referrers up to 3 levels for commission calculation.
     * @param userId - The ID of the user whose referrers are needed.
     * @returns An object containing referrer IDs for level 1, 2, and 3, or null if none exist.
     */
    async getReferrerIds(userId: string | Types.ObjectId): Promise<{ level1?: string, level2?: string, level3?: string } | null> {
        try {
            const userObjectId = new Types.ObjectId(userId.toString());
            const referrers: { level1?: string, level2?: string, level3?: string } = {};

            // Level 1
            const l1Referrer = await referralRepository.findDirectReferrerPopulated(userObjectId);
            if (l1Referrer?._id) {
                referrers.level1 = l1Referrer._id.toString();

                // Level 2
                const l2Referrer = await referralRepository.findDirectReferrerPopulated(l1Referrer._id);
                if (l2Referrer?._id) {
                    referrers.level2 = l2Referrer._id.toString();

                    // Level 3
                    const l3Referrer = await referralRepository.findDirectReferrerPopulated(l2Referrer._id);
                    if (l3Referrer?._id) {
                        referrers.level3 = l3Referrer._id.toString();
                    }
                }
            }

            // Return null if no referrers found at all
            return Object.keys(referrers).length > 0 ? referrers : null;

        } catch (error) {
            log.error(`Error getting referrer IDs for user ${userId}:`, error);
            throw error; // Rethrow for controller to handle
        }
    }

    /**
     * Retrieves active subscription type(s) for a user.
     * Needed by controller to check permissions (e.g., CIBLE for filtering).
     * @param userId User ID
     * @returns Array containing active SubscriptionType enums ('CLASSIQUE', 'CIBLE')
     */
    async getUserSubscriptionInfo(userId: string | Types.ObjectId): Promise<SubscriptionType[]> {
        try {
            const userObjectId = new Types.ObjectId(userId);
            // Use the imported subscriptionService instance
            const activeTypes = await subscriptionService.getActiveSubscriptionTypes(userObjectId.toString());
            return activeTypes;
        } catch (error) {
            log.error(`Error getting subscription info for user ${userId}:`, error);
            // Return empty array or rethrow depending on desired error handling
            return [];
        }
    }

    /**
     * Searches for contact users based on criteria, considering sharing preferences and subscription level.
     * @param requestingUserId ID of the user performing the search (to exclude them from results).
     * @param filters Search criteria provided by the user.
     * @param pagination Page and limit for results.
     * @param activeSubscriptionType The active subscription type of the requesting user ('CLASSIQUE', 'CIBLE', or null).
     * @returns Paginated list of users matching criteria who allow sharing.
     */
    async searchContacts(
        requestingUserId: string | Types.ObjectId,
        filters: ContactSearchFilters | undefined,
        pagination: PaginationOptions,
        activeSubscriptionType: SubscriptionType | null // Changed from applyFilters boolean
    ): Promise<{ data: Partial<IUser>[]; paginationInfo: any }> {
        log.info(`Searching contacts requested by ${requestingUserId}. Subscription: ${activeSubscriptionType}`, { filters, pagination });

        if (!activeSubscriptionType) {
            log.error(`User ${requestingUserId} has no active subscription. Cannot search contacts.`);
            throw new Error('Active subscription required to search or export contacts.');
        }

        const { page = 1, limit = 10 } = pagination;
        const skip = (page - 1) * limit;
        const requestorObjectId = new Types.ObjectId(requestingUserId);

        const query: FilterQuery<IUser> = {
            _id: { $ne: requestorObjectId }, // Exclude the requesting user
            shareContactInfo: true,         // Only include users who allow sharing
            deleted: { $ne: true },         // Exclude soft-deleted users
            blocked: { $ne: true },         // Exclude blocked users
            isVerified: true                // Only include verified users
        };

        // --- Apply Filters based on Subscription --- 
        let appliedFilterCount = 0;
        const applyCommonFilters = (targetQuery: FilterQuery<IUser>) => {
            if (filters?.country) {
                targetQuery.country = { $regex: `^${filters.country}$`, $options: 'i' };
                appliedFilterCount++;
            }
            if (filters?.region) {
                targetQuery.region = { $regex: `^${filters.region}$`, $options: 'i' };
                appliedFilterCount++;
            }
            if (filters?.city) {
                targetQuery.city = { $regex: `^${filters.city}$`, $options: 'i' };
                appliedFilterCount++;
            }
            if (filters?.sex) {
                targetQuery.sex = filters.sex;
                appliedFilterCount++;
            }
            if (filters?.language) {
                targetQuery.language = { $in: [new RegExp(filters.language, 'i')] };
                appliedFilterCount++;
            }
            if (filters?.profession) {
                targetQuery.profession = { $regex: filters.profession, $options: 'i' };
                appliedFilterCount++;
            }
            if (filters?.interests && filters.interests.length > 0) {
                targetQuery.interests = { $in: filters.interests.map((interest: string) => new RegExp(interest, 'i')) };
                appliedFilterCount++;
            }
            if (filters?.minAge || filters?.maxAge) {
                const now = new Date();
                const dobQuery: { $lte?: Date, $gte?: Date } = {};
                if (filters.minAge) {
                    const maxDob = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
                    dobQuery.$lte = maxDob;
                }
                if (filters.maxAge) {
                    const minDob = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
                    dobQuery.$gte = minDob;
                }
                targetQuery.birthDate = dobQuery;
                appliedFilterCount++;
            }
        };

        if (filters) {
            if (activeSubscriptionType === SubscriptionType.CLASSIQUE) {
                // CLASSIC: Only Country filter allowed
                if (filters.country) {
                    query.country = { $regex: `^${filters.country}$`, $options: 'i' };
                    appliedFilterCount++;
                    log.debug(`CLASSIQUE plan: Applied country filter: ${filters.country}`);
                }
                // Log if other filters were provided but ignored
                const ignoredFilters = { ...filters };
                delete ignoredFilters.country;
                delete ignoredFilters.page;
                delete ignoredFilters.limit;
                if (Object.keys(ignoredFilters).length > 0) {
                    log.warn(`CLASSIQUE plan: Ignoring filters other than country: ${Object.keys(ignoredFilters).join(', ')}`);
                }
            } else if (activeSubscriptionType === SubscriptionType.CIBLE) {
                // CIBLE: Apply all relevant filters
                log.debug("CIBLE plan: Applying all provided filters.");
                applyCommonFilters(query);
            }
        }

        if (appliedFilterCount === 0 && filters && Object.keys(filters).length > 0) {
            log.warn(`Filters were provided but none were applicable for subscription type ${activeSubscriptionType}`);
        }
        // --- End Filter Application --- 

        try {
            log.debug("Executing contacts query:", query);
            const totalCount = await UserModel.countDocuments(query).exec();
            const users = await UserModel.find(query)
                .skip(skip)
                .limit(limit)
                .select('name email phoneNumber country region city sex language interests profession ipCity ipCountry avatar shareContactInfo birthDate createdAt')
                .lean()
                .exec();

            const mappedUsers = users.map((user: FlattenMaps<IUser>) => this.mapUserToResponse(user));

            const totalPages = Math.ceil(totalCount / limit);
            const paginationInfo = {
                totalCount,
                totalPages,
                currentPage: page,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            log.info(`Contact search returned ${users.length} users.`);
            return { data: mappedUsers, paginationInfo };

        } catch (error) {
            log.error(`Error searching contacts:`, error);
            throw new Error('Failed to search contacts.');
        }
    }

    /**
     * Logs in an admin user.
     * Verifies credentials and checks for ADMIN role.
     * No OTP required for admin login in this implementation.
     * @param email - Admin's email.
     * @param passwordAttempt - Admin's password.
     * @param ipAddress - Optional IP address for logging/auditing.
     * @returns An object containing the JWT token and admin user details (excluding sensitive fields).
     */
    async loginAdmin(
        email: string,
        passwordAttempt: string,
        ipAddress?: string
    ): Promise<{ token: string; user: Omit<IUser, 'password' | 'otps' | 'contactsOtps' | 'token'> }> {
        if (!email || !passwordAttempt) {
            log.warn('Admin login attempt failed: Email and password are required.');
            throw new Error('Email and password are required');
        }

        const user = await userRepository.findByEmail(email, true); // Need password

        if (!user || !user.password) {
            log.warn(`Admin login attempt failed: User not found or no password for email: ${email}`);
            throw new Error('Invalid email or password');
        }

        // --- Role Check ---
        if (user.role !== UserRole.ADMIN) {
            log.warn(`Admin login attempt failed: User ${email} does not have ADMIN role.`);
            throw new Error('Access Denied: Not an admin user');
        }
        // --- End Role Check ---

        const isMatch = await bcrypt.compare(passwordAttempt, user.password);
        if (!isMatch) {
            log.warn(`Admin login attempt failed: Invalid password for admin: ${email}`);
            throw new Error('Invalid email or password');
        }

        if (user.blocked) {
            log.warn(`Admin login attempt failed: Admin account ${email} is blocked.`);
            throw new Error('User account is blocked');
        }

        if (user.deleted) {
            log.warn(`Admin login attempt failed: Admin account ${email} is deleted.`);
            throw new Error('User account is deleted');
        }

        // --- IP Address Update (Optional for Admin) ---
        if (ipAddress && ipAddress !== user.ipAddress) {
            try {
                // Don't wait for this, let it run in the background
                userRepository.updateIpAddress(user._id, { ipAddress });
                log.info(`Updated IP address for admin ${email} during login.`);
            } catch (ipError) {
                log.error(`Failed to update IP on admin login for ${user.email}`, ipError);
            }
        }
        // --- End IP Update ---

        // --- Generate JWT for Admin ---
        const tokenPayload = { userId: user._id, id: user._id, email: user.email, role: user.role };
        const token = signToken(tokenPayload);

        // Optionally update the last login time or store the token if needed for session management
        await userRepository.updateById(user._id, { token: token }); // Example if storing token

        log.info(`Admin user ${email} logged in successfully.`);

        return {
            token,
            user: this.mapUserToResponse(user) // Exclude sensitive fields
        };
    }

    /**
     * Finds user IDs based on provided criteria.
     *
     * @param criteria - The targeting criteria.
     * @param limit - Maximum number of IDs to return.
     * @returns An array of user IDs (strings).
     */
    async findUserIdsByCriteria(criteria: ITargetCriteria, limit: number = 10000): Promise<string[]> {
        log.info('Finding users by criteria', { criteria, limit });
        try {
            const query: FilterQuery<IUser> = {};

            // Build the query dynamically based on provided criteria
            if (criteria.regions && criteria.regions.length > 0) {
                // Assuming 'address.city' or similar holds region info
                // Adjust field path as needed based on your User model structure
                query['address.city'] = { $in: criteria.regions.map(r => new RegExp(r, 'i')) }; // Case-insensitive match
            }
            if (criteria.sex) {
                query.sex = criteria.sex;
            }
            if (criteria.interests && criteria.interests.length > 0) {
                // Assuming 'profile.interests' is an array
                query['profile.interests'] = { $in: criteria.interests };
            }
            if (criteria.professions && criteria.professions.length > 0) {
                // Assuming 'profile.profession' is a string field
                query['profile.profession'] = { $in: criteria.professions.map(p => new RegExp(p, 'i')) }; // Case-insensitive match
            }

            // Handle age range - assumes 'dob' (Date of Birth) field exists
            if (criteria.minAge || criteria.maxAge) {
                query.dob = {};
                const now = new Date();
                if (criteria.minAge) {
                    // Users must be AT LEAST minAge years old
                    // Their DoB must be less than or equal to (now - minAge years)
                    const maxDob = new Date(now.getFullYear() - criteria.minAge, now.getMonth(), now.getDate());
                    query.dob.$lte = maxDob;
                }
                if (criteria.maxAge) {
                    // Users must be AT MOST maxAge years old
                    // Their DoB must be greater than or equal to (now - (maxAge + 1) years)
                    const minDob = new Date(now.getFullYear() - criteria.maxAge - 1, now.getMonth(), now.getDate());
                    query.dob.$gte = minDob;
                }
            }

            // Ensure only active users are returned (assuming an 'isActive' or 'status' field)
            query.status = 'active'; // Or query.isActive = true; Adjust based on your model

            // TODO: Add indexing to the queried fields (dob, address.city, sex, profile.interests, profile.profession, status/isActive) in UserModel for performance.

            log.debug('Executing user find query with criteria:', query);

            // Execute query directly on the UserModel
            const users = await UserModel.find(query) // Use UserModel.find
                .select('_id')
                .limit(limit)
                .lean();

            // Specify type for user in map
            const userIds = users.map((user: { _id: Types.ObjectId }) => user._id.toString());
            log.info(`Found ${userIds.length} users matching criteria.`);
            return userIds;

        } catch (error: any) {
            log.error('Error finding users by criteria:', error);
            // Throw a generic error since AppError is not available
            throw new Error('Failed to retrieve users based on criteria.');
        }
    }

    /**
     * Find users based on various criteria, with pagination and optional subscription filtering.
     *
     * @param filters Search criteria (ContactSearchFilters).
     * @param pagination Pagination options (page, limit).
     * @param filterByActiveSubscription If true, only return users with active subscriptions.
     * @returns Paginated list of users.
     */
    async findUsersByCriteria(
        filters: ContactSearchFilters,
        pagination: PaginationOptions,
        filterByActiveSubscription: boolean = false // Add new parameter
    ): Promise<{ users: Partial<IUser>[], page: number, limit: number, totalCount: number, totalPages: number }> {
        const { page, limit } = pagination;
        const skip = (page - 1) * limit;

        const query: FilterQuery<IUser> = {};

        // --- Build query from filters ---
        if (filters.country) query.country = { $regex: `^${filters.country.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.region) query.region = { $regex: `^${filters.region.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.city) query.city = { $regex: `^${filters.city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.sex) query.sex = filters.sex;
        if (filters.language) query.language = { $in: [new RegExp(filters.language.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i')] };
        if (filters.profession) query.profession = { $regex: filters.profession.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), $options: 'i' };
        if (filters.interests && filters.interests.length > 0) {
            query.interests = { $in: filters.interests.map(i => new RegExp(i.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i')) };
        }
        // MODIFIED: Apply search filter to name, email, or phoneNumber fields using $or
        if (filters.name) { // Assuming 'name' filter is now used for generic search
            const searchRegex = new RegExp(filters.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
            query.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phoneNumber: searchRegex } // Added phoneNumber to the search
            ];
        }
        if (filters.minAge || filters.maxAge) {
            query.birthDate = {};
            const now = new Date();
            if (filters.minAge) {
                const maxBirthDate = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
                query.birthDate.$lte = maxBirthDate;
            }
            if (filters.maxAge) {
                const minBirthDate = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
                query.birthDate.$gte = minBirthDate;
            }
        }
        if (filters.registrationDateStart || filters.registrationDateEnd) {
            query.createdAt = {};
            if (filters.registrationDateStart) {
                query.createdAt.$gte = filters.registrationDateStart;
            }
            if (filters.registrationDateEnd) {
                query.createdAt.$lte = filters.registrationDateEnd;
            }
        }
        // --- End build query ---

        // --- Add filter for active subscribers --- 
        if (filterByActiveSubscription) {
            try {
                // Fetch IDs of users with any active subscription
                const activeUserIds = await this.subscriptionRepository.findAllUserIdsWithActiveSubscriptions();

                // If no users have active subscriptions, the query result will be empty
                if (activeUserIds.length === 0) {
                    log.info('findUsersByCriteria: No users found with active subscriptions.');
                    return { users: [], page, limit, totalCount: 0, totalPages: 0 };
                }

                // Add the $in condition to the main query
                query._id = { $in: activeUserIds }; // Filter by the list of active user IDs
            } catch (subError) {
                log.error('Error fetching active subscriber IDs in findUsersByCriteria:', subError);
                // Decide how to handle: throw error or return empty results?
                // Returning empty seems safer for now.
                return { users: [], page, limit, totalCount: 0, totalPages: 0 };
            }
        }
        // --- End active subscriber filter ---

        // Exclude blocked users and potentially the requesting user (if needed)
        query.blocked = { $ne: true };
        // Add query.deleted = { $ne: true }; if using soft delete from repository directly isn't sufficient

        // --- Perform Search and Pagination ---
        try {
            log.debug(`Finding users with criteria: ${JSON.stringify(query)}, page: ${page}, limit: ${limit}`);
            const totalCount = await userRepository.countDocuments(query);
            const users = await userRepository.find(query, {
                skip,
                limit,
                sort: { createdAt: -1 }, // Example sort
                // Select specific fields to return (exclude sensitive ones)
                select: 'name email phoneNumber country region city sex language profession interests avatar avatarId createdAt'
            });

            return {
                users: users.map((user: IUser) => this.mapUserToResponse(user)), // Map to exclude sensitive fields
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
            };
        } catch (error) {
            log.error('Error finding users by criteria:', error);
            throw error; // Re-throw for controller to handle
        }
    }

    /**
    * Find ALL users matching criteria, processing them in batches.
    * Used for large exports to avoid high memory usage.
    * @param filters Search criteria (ContactSearchFilters).
    * @param filterByActiveSubscription If true, only return users with active subscriptions.
    * @param batchSize The number of users to fetch in each batch.
    * @param processBatch A callback function to process each batch of users.
    */
    async findAllUsersByCriteriaInBatches(
        filters: ContactSearchFilters,
        filterByActiveSubscription: boolean = false,
        batchSize: number = 1000, // Default batch size
        processBatch: (users: Partial<IUser>[]) => Promise<void> // Ensure this returns Promise<void>
    ): Promise<void> { // Ensure the main function also returns Promise<void>
        const query: FilterQuery<IUser> = {};

        // --- Build query from filters (same logic as findAllUsersByCriteria) ---
        if (filters.country) query.country = { $regex: `^${filters.country.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.region) query.region = { $regex: `^${filters.region.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.city) query.city = { $regex: `^${filters.city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.sex) query.sex = filters.sex;
        if (filters.language) {
            query.language = { $elemMatch: { $regex: `^${filters.language.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, $options: 'i' } };
        }
        if (filters.profession) query.profession = { $regex: `^${filters.profession.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, $options: 'i' };
        if (filters.interests && filters.interests.length > 0) {
            query.interests = {
                $in: filters.interests.map(i => new RegExp(`^${i.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i'))
            };
        }
        // MODIFIED: Apply search filter to name, email, or phoneNumber fields using $or
        if (filters.name) { // Assuming 'name' filter is now used for generic search
            const searchRegex = new RegExp(filters.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
            query.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phoneNumber: searchRegex } // Added phoneNumber to the search
            ];
        }
        if (filters.minAge || filters.maxAge) {
            query.birthDate = {};
            const now = new Date();
            if (filters.minAge) {
                const maxBirthDate = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
                query.birthDate.$lte = maxBirthDate;
            }
            if (filters.maxAge) {
                const minBirthDate = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
                query.birthDate.$gte = minBirthDate;
            }
        }
        if (filters.registrationDateStart || filters.registrationDateEnd) {
            query.createdAt = {};
            if (filters.registrationDateStart) {
                query.createdAt.$gte = filters.registrationDateStart;
            }
            if (filters.registrationDateEnd) {
                query.createdAt.$lte = filters.registrationDateEnd;
            }
        }
        // --- End build query ---

        if (filterByActiveSubscription) {
            try {
                const activeUserIds = await this.subscriptionRepository.findAllUserIdsWithActiveSubscriptions();
                if (activeUserIds.length === 0) {
                    log.info('findAllUsersByCriteriaInBatches: No users found with active subscriptions.');
                    return; // No users to process
                }
                query._id = { $in: activeUserIds };
            } catch (subError) {
                log.error('Error fetching active subscriber IDs in findAllUsersByCriteriaInBatches:', subError);
                throw subError; // Rethrow to indicate failure
            }
        }
        query.blocked = { $ne: true };

        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            log.info(`Fetching batch of users: skip=${skip}, limit=${batchSize}`);
            const users = await userRepository.find(query, {
                skip: skip,
                limit: batchSize,
                sort: { _id: 1 }, // Consistent sort order for pagination (use _id for performance)
                select: '_id name email phoneNumber country region city birthDate sex language profession interests avatar createdAt'
            });

            if (users.length > 0) {
                await processBatch(users.map(user => this.mapUserToResponse(user)));
                skip += users.length;
                if (users.length < batchSize) {
                    hasMore = false; // Last batch fetched
                }
            } else {
                hasMore = false; // No more users found
            }
        }
        log.info('Finished processing all batches.');
        // Explicitly return if all paths don't guarantee a void return due to async nature or conditional returns
        return;
    }

    /**
    * Find ALL users matching criteria, without pagination.
    * Used for export.
    * @param filters Search criteria (ContactSearchFilters).
    * @param filterByActiveSubscription If true, only return users with active subscriptions.
    * @returns Array of matching users.
    */
    async findAllUsersByCriteria(
        filters: ContactSearchFilters,
        filterByActiveSubscription: boolean = false // Add parameter
    ): Promise<Partial<IUser>[]> {
        const query: FilterQuery<IUser> = {};

        // --- Build query from filters (same as findUsersByCriteria) ---
        if (filters.country) query.country = { $regex: `^${filters.country.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.region) query.region = { $regex: `^${filters.region.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.city) query.city = { $regex: `^${filters.city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, $options: 'i' };
        if (filters.sex) query.sex = filters.sex;
        if (filters.language) {
            // Assuming filters.language is a single string to search for as a prefix in the array elements
            query.language = { $elemMatch: { $regex: `^${filters.language.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, $options: 'i' } };
        }
        if (filters.profession) query.profession = { $regex: `^${filters.profession.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, $options: 'i' }; // Anchored regex
        if (filters.interests && filters.interests.length > 0) {
            // Assuming filters.interests is an array of strings, match any interest starting with the given terms
            query.interests = {
                $in: filters.interests.map(i => new RegExp(`^${i.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i'))
            };
        }
        // MODIFIED: Apply search filter to name, email, or phoneNumber fields using $or
        if (filters.name) { // Assuming 'name' filter is now used for generic search
            const searchRegex = new RegExp(filters.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
            query.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phoneNumber: searchRegex } // Added phoneNumber to the search
            ];
        }
        if (filters.minAge || filters.maxAge) {
            query.birthDate = {};
            const now = new Date();
            if (filters.minAge) {
                const maxBirthDate = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
                query.birthDate.$lte = maxBirthDate;
            }
            if (filters.maxAge) {
                const minBirthDate = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
                query.birthDate.$gte = minBirthDate;
            }
        }
        if (filters.registrationDateStart || filters.registrationDateEnd) {
            query.createdAt = {};
            if (filters.registrationDateStart) {
                query.createdAt.$gte = filters.registrationDateStart;
            }
            if (filters.registrationDateEnd) {
                query.createdAt.$lte = filters.registrationDateEnd;
            }
        }
        // --- End build query ---

        // --- Add filter for active subscribers (same as findUsersByCriteria) ---
        if (filterByActiveSubscription) {
            try {
                const activeUserIds = await this.subscriptionRepository.findAllUserIdsWithActiveSubscriptions();
                if (activeUserIds.length === 0) {
                    log.info('findAllUsersByCriteria: No users found with active subscriptions.');
                    return []; // Return empty array if no active users
                }
                query._id = { $in: activeUserIds };
            } catch (subError) {
                log.error('Error fetching active subscriber IDs in findAllUsersByCriteria:', subError);
                return []; // Return empty on error
            }
        }
        // --- End active subscriber filter ---

        query.blocked = { $ne: true };

        // --- Perform Search (No Pagination) ---
        try {
            const users = await userRepository.find(query, {
                // No skip/limit
                sort: { createdAt: -1 },
                // Include city
                select: '_id name email phoneNumber country region city birthDate sex language profession interests avatar createdAt'
            });

            // Specify type for user parameter in map
            return users.map((user: IUser) => this.mapUserToResponse(user));
        } catch (error) {
            log.error('Error finding all users by criteria:', error);
            throw error;
        }
    }

    // --- Admin Specific Methods ---

    /**
     * [Admin] Get summary statistics about users and subscriptions.
     */
    async adminGetUserSummaryStats(): Promise<{
        totalUsers: number;
        activeClassique: number;
        activeCible: number;
        // Add more stats as needed (e.g., totalBlocked, totalVerified)
    }> {
        log.info('Admin request for user summary stats');
        try {
            // Fetch counts in parallel
            const [totalUserCount, classiqueCount, cibleCount] = await Promise.all([
                userRepository.countDocuments({ deleted: { $ne: true } }), // Count non-deleted users
                subscriptionRepository.countActiveSubscriptionsByType(SubscriptionType.CLASSIQUE),
                subscriptionRepository.countActiveSubscriptionsByType(SubscriptionType.CIBLE)
            ]);

            log.debug('User summary stats results:', { totalUserCount, classiqueCount, cibleCount });

            return {
                totalUsers: totalUserCount,
                activeClassique: classiqueCount,
                activeCible: cibleCount
            };
        } catch (error) {
            log.error('Error getting admin user summary stats:', error);
            throw new Error('Failed to retrieve user summary statistics.');
        }
    }

    /**
     * [Admin] List users with filtering and pagination.
     */
    async adminListUsers(filters: { status?: string; role?: string; search?: string }, pagination: PaginationOptions): Promise<{ users: (Partial<IUser> & { partnerPack?: 'silver' | 'gold' })[], paginationInfo: any }> {
        log.info('Admin request to list users with filters:', { filters, pagination });
        const { page = 1, limit = 10 } = pagination;
        const skip = (page - 1) * limit;

        const query: FilterQuery<IUser> = {};

        // Apply filters
        if (filters.status) {
            if (filters.status === 'active') query.blocked = { $ne: true };
            if (filters.status === 'blocked') query.blocked = true;
            if (filters.status === 'deleted') query.deleted = true; // Assuming soft delete
            if (filters.status === 'unverified') query.isVerified = { $ne: true };
            // Add more status filters as needed
        }

        if (filters.role && Object.values(UserRole).includes(filters.role as UserRole)) {
            query.role = filters.role as UserRole;
        }

        if (filters.search) {
            const searchRegex = new RegExp(filters.search, 'i');
            // Only search string fields (name, email) with the regex
            query.$or = [
                { name: searchRegex },
                { email: searchRegex }
                // Remove: { phoneNumber: searchRegex } - Cannot apply Regex to Number field
            ];
        }

        // Always exclude deleted unless explicitly requested
        if (filters.status !== 'deleted') {
            query.deleted = { $ne: true };
        }

        try {
            const totalCount = await userRepository.countDocuments(query);
            const usersFromDb = await userRepository.find(query, {
                skip,
                limit,
                sort: { createdAt: -1 },
                select: '_id name email role balance blocked isVerified createdAt ipAddress referralCode phoneNumber region country city'
            });

            // Extract user IDs to fetch partner statuses
            const userIds = usersFromDb.map(u => u._id);
            let partnerPackMap = new Map<string, 'silver' | 'gold'>();

            if (userIds.length > 0) {
                // Ensure all IDs are ObjectIds before passing to the service method
                const objectIdsToFetch = userIds.map(id => typeof id === 'string' ? new Types.ObjectId(id) : id);
                const activePartners = await partnerService.getActivePartnersByUserIds(objectIdsToFetch);
                activePartners.forEach(partner => {
                    partnerPackMap.set(partner.user.toString(), partner.pack);
                });
            }

            const usersWithPartnerPack = usersFromDb.map(user => ({
                ...(typeof user.toObject === 'function' ? user.toObject() : { ...user }),
                partnerPack: partnerPackMap.get(user._id.toString())
            }));

            const totalPages = Math.ceil(totalCount / limit);
            const paginationInfo = {
                totalCount,
                totalPages,
                currentPage: page,
                limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            // Map to response to exclude sensitive fields if needed, though admin might see more
            // const mappedUsers = users.map(user => this.mapUserToResponse(user));
            return { users: usersWithPartnerPack, paginationInfo }; // Return users with partner pack

        } catch (error) {
            log.error('Error listing users (admin):', error);
            throw new Error('Failed to list users.');
        }
    }

    /**
     * [Admin] Get full details for a specific user.
     * Returns the complete user document, including active subscription types and partner pack.
     */
    async adminGetUserById(userId: string | Types.ObjectId): Promise<Partial<IUser> & { activeSubscriptionTypes?: SubscriptionType[], partnerPack?: 'silver' | 'gold' } | null> {
        log.info(`Admin request to get full details for user: ${userId}`);
        try {
            const user = await userRepository.findById(userId);

            if (!user || user.deleted) { // Check for soft delete
                log.warn(`Admin request failed: User ${userId} not found or deleted.`);
                return null;
            }

            // Fetch active subscription types and partner status in parallel
            const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
            const [activeSubscriptionTypes, activePartner] = await Promise.all([
                subscriptionService.getActiveSubscriptionTypes(userObjectId.toString()),
                partnerService.getActivePartnerByUserId(userObjectId.toString()) // Fetch partner status
            ]);

            log.debug(`Active subscriptions for user ${userId}:`, activeSubscriptionTypes);
            if (activePartner) {
                log.debug(`User ${userId} is an active partner with pack: ${activePartner.pack}`);
            }

            // Create a mutable user object (if it's a Mongoose doc)
            const userObject = typeof user.toObject === 'function' ? user.toObject() : { ...user };

            // Remove sensitive fields
            delete userObject.password;
            delete userObject.otps;
            delete userObject.contactsOtps;
            delete userObject.token;

            // Add subscription types to the returned object
            const result = {
                ...userObject,
                activeSubscriptionTypes: activeSubscriptionTypes.length > 0 ? activeSubscriptionTypes : undefined,
                partnerPack: activePartner ? activePartner.pack : undefined // Add partnerPack
            };

            return result;
        } catch (error) {
            log.error(`Error getting user details for ${userId} (admin):`, error);
            throw new Error('Failed to get user details.');
        }
    }

    /**
     * [Admin] Update user details (role, verification, blocked status, etc.).
     */
    async adminUpdateUser(userId: string | Types.ObjectId, updateData: Partial<IUser>): Promise<IUser | null> {
        log.info(`Admin request to update user: ${userId}`, { updateData });

        // --- Input Validation & Sanitization --- 
        const allowedAdminUpdates: Partial<IUser> = {};

        // Example: Allow updating role, blocked, isVerified, maybe name/email
        if (updateData.role !== undefined) {
            if (!Object.values(UserRole).includes(updateData.role as UserRole)) {
                throw new Error('Invalid user role provided.');
            }
            allowedAdminUpdates.role = updateData.role;
        }
        if (updateData.blocked !== undefined) {
            allowedAdminUpdates.blocked = !!updateData.blocked; // Ensure boolean
        }
        if (updateData.isVerified !== undefined) {
            allowedAdminUpdates.isVerified = !!updateData.isVerified; // Ensure boolean
        }
        if (updateData.name !== undefined) {
            allowedAdminUpdates.name = updateData.name;
        }
        if (updateData.email !== undefined) {
            // Add validation if allowing email change (check for duplicates)
            const existing = await userRepository.findByEmail(updateData.email);
            if (existing && existing._id.toString() !== userId.toString()) {
                throw new Error('Email address is already in use by another account.');
            }
            allowedAdminUpdates.email = updateData.email;
        }
        // Add other fields admins can update here (e.g., phoneNumber, region...)
        if (updateData.phoneNumber !== undefined) {
            // Add phone number validation if needed
            allowedAdminUpdates.phoneNumber = updateData.phoneNumber;
        }
        if (updateData.region !== undefined) {
            allowedAdminUpdates.region = updateData.region;
        }
        if (updateData.country !== undefined) {
            // Add basic validation for ISO code format (2 letters)
            if (typeof updateData.country === 'string' && updateData.country.length === 2) {
                allowedAdminUpdates.country = updateData.country.toUpperCase(); // Store as uppercase
            } else {
                log.warn(`Admin update user ${userId}: Invalid country code format provided: ${updateData.country}`);
                // Optionally throw an error: throw new Error('Invalid country code format. Must be 2 letters.');
            }
        }
        if (updateData.city !== undefined) {
            allowedAdminUpdates.city = updateData.city;
        }
        // Allow updating momo details
        if (updateData.momoNumber !== undefined) {
            allowedAdminUpdates.momoNumber = updateData.momoNumber;
        }
        if (updateData.momoOperator !== undefined) {
            allowedAdminUpdates.momoOperator = updateData.momoOperator;
        }

        // Prevent admins from directly setting password, balance, otps, etc.
        delete allowedAdminUpdates.password;
        delete allowedAdminUpdates.balance;
        delete allowedAdminUpdates.otps;
        delete allowedAdminUpdates.contactsOtps;
        delete allowedAdminUpdates.token;

        if (Object.keys(allowedAdminUpdates).length === 0) {
            log.warn(`Admin update user ${userId}: No valid fields provided for update.`);
            // Fetch the user directly to match the return type IUser | null
            const currentUser = await userRepository.findById(userId);
            return currentUser; // Return the fetched user or null
        }
        // --- End Validation --- 

        try {
            const updatedUser = await userRepository.updateById(userId, allowedAdminUpdates);
            log.info(`Admin successfully updated user ${userId}`);
            return updatedUser; // Return updated user
        } catch (error) {
            log.error(`Error updating user ${userId} (admin):`, error);
            // Handle potential duplicate key errors if email/phone changed
            if (error instanceof Error && error.message.includes('duplicate key')) {
                throw new Error('Update failed due to duplicate email or phone number.');
            }
            throw new Error('Failed to update user.');
        }
    }

    /**
     * [Admin] Set the block status for a user.
     */
    async adminSetBlockStatus(userId: string | Types.ObjectId, blocked: boolean): Promise<void> {
        log.info(`Admin request to set block status for user ${userId} to ${blocked}`);
        try {
            await userRepository.updateById(userId, { blocked });
            log.info(`Successfully set block status for user ${userId} to ${blocked}`);
        } catch (error) {
            log.error(`Error setting block status for user ${userId} (admin):`, error);
            throw new Error('Failed to update user block status.');
        }
    }

    /**
     * [Admin] Adjust user balance with an audit trail.
     */
    async adminAdjustBalance(userId: string | Types.ObjectId, amount: number, reason: string, adminUserId: string | Types.ObjectId): Promise<number | null> {
        log.info(`Admin ${adminUserId} adjusting balance for user ${userId}. Amount: ${amount}, Reason: ${reason}`);

        if (typeof amount !== 'number') {
            throw new Error('Invalid amount for balance adjustment.');
        }
        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            throw new Error('Reason is required for balance adjustment.');
        }

        try {
            // Perform the balance update
            const updatedUser = await userRepository.updateBalance(userId, amount);

            if (updatedUser) {
                // --- Audit Log Placeholder --- 
                // In a real system, insert a record into an AuditLog collection/table
                log.info(`AUDIT: Admin Balance Adjustment`, {
                    adminUserId: adminUserId.toString(),
                    targetUserId: userId.toString(),
                    amount: amount,
                    newBalance: updatedUser.balance,
                    reason: reason,
                    timestamp: new Date().toISOString()
                });
                // --- End Audit Log Placeholder --- 
                return updatedUser.balance;
            } else {
                log.warn(`Admin balance adjustment failed: User ${userId} not found.`);
                return null;
            }
        } catch (error) {
            log.error(`Error adjusting balance for user ${userId} (admin ${adminUserId}):`, error);
            throw new Error('Failed to adjust user balance.');
        }
    }

    /**
     * [Admin] Find users who have never had a successful subscription.
     * This is a basic example; criteria might need adjustment based on exact subscription logic.
     */
    async findUsersWithoutInitialSubscription(): Promise<Partial<IUser>[]> {
        log.info('Finding users without initial successful subscription');
        try {
            // 1. Get IDs of all users who HAVE had a successful subscription
            const userIdsWithSubscription = await this.subscriptionRepository.findAllUserIdsWithActiveSubscriptions();

            // 2. Find users whose IDs are NOT in the above list
            const query: FilterQuery<IUser> = {
                _id: { $nin: userIdsWithSubscription }, // Find users NOT IN the list
                // Additional filters? e.g., exclude blocked/deleted users?
                blocked: { $ne: true },
                deleted: { $ne: true },
                // You might want to filter by registration date if this is only for recent users
                // createdAt: { $gte: new Date('2023-01-01') } 
            };

            // Select only the necessary fields for the export
            const users = await userRepository.find(query, {
                select: '_id name email phoneNumber region country createdAt',
                sort: { createdAt: -1 }
            });

            log.info(`Found ${users.length} users without initial successful subscription.`);
            // Map to response format if necessary (though admin might see raw data)
            return users;

        } catch (error) {
            log.error('Error finding users without initial subscription:', error);
            throw new Error('Failed to find users for export.');
        }
    }

    /**
     * [Admin] Get total user balance aggregated by country.
     */
    async getAggregatedBalanceByCountry(): Promise<{ _id: string | null; totalBalance: number }[]> {
        log.info('Aggregating total balance by country for admin dashboard');
        try {
            const aggregationResult = await UserModel.aggregate([
                {
                    $match: {
                        // Optional: Filter out blocked/deleted users if necessary
                        blocked: { $ne: true },
                        deleted: { $ne: true }
                    }
                },
                {
                    $group: {
                        _id: '$country', // Group by the country field
                        totalBalance: { $sum: '$balance' } // Sum the balance for each group
                    }
                },
                {
                    $sort: { totalBalance: -1 } // Sort by total balance descending
                },
                {
                    $project: { // Optional: Rename _id to country for clarity
                        country: '$_id',
                        totalBalance: 1,
                        _id: 0 // Exclude the default _id
                    }
                }
            ]).exec();

            // Handle null country case if necessary
            return aggregationResult.map(item => ({
                _id: item.country, // Use renamed field
                totalBalance: item.totalBalance
            }));

        } catch (error) {
            log.error('Error aggregating balance by country:', error);
            throw new Error('Failed to aggregate balance by country.');
        }
    }

    /**
     * [Admin] Get monthly registration and active subscription counts.
     * Note: This requires corresponding aggregation methods in SubscriptionRepository.
     */
    async getMonthlyActivityStats(months: number = 12): Promise<any[]> {
        log.info(`Getting monthly activity stats for the last ${months} months`);
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - months);
            startDate.setDate(1); // Start from beginning of the month
            startDate.setHours(0, 0, 0, 0);

            // 1. Aggregate Registrations per Month (from UserModel)
            const registrationStatsPromise = UserModel.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startDate, $lte: endDate },
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        registeredCount: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } },
                {
                    $project: {
                        _id: 0,
                        month: { $concat: [{ $toString: '$_id.year' }, '-', { $toString: '$_id.month' }] }, // Format as YYYY-M
                        registeredCount: 1
                    }
                }
            ]).exec();

            // 2. Get Monthly Active Subscription Counts from SubscriptionRepository
            const classiqueSubsPromise = this.subscriptionRepository.getMonthlyActiveSubscriptionCounts(SubscriptionType.CLASSIQUE, startDate, endDate);
            const cibleSubsPromise = this.subscriptionRepository.getMonthlyActiveSubscriptionCounts(SubscriptionType.CIBLE, startDate, endDate);

            // Run aggregations in parallel
            const [registrationStats, classiqueSubs, cibleSubs] = await Promise.all([
                registrationStatsPromise,
                classiqueSubsPromise,
                cibleSubsPromise
            ]);
            log.debug('Monthly aggregation results:', { registrationStats, classiqueSubs, cibleSubs });

            // 3. Combine the results
            const combinedStatsMap = new Map<string, any>();

            // Initialize map with all months in the range
            let currentMonthDate = new Date(startDate);
            while (currentMonthDate <= endDate) {
                const monthKey = `${currentMonthDate.getFullYear()}-${currentMonthDate.getMonth() + 1}`;
                combinedStatsMap.set(monthKey, { month: monthKey, registered: 0, classiqueActive: 0, cibleActive: 0 });
                currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
            }

            registrationStats.forEach(stat => {
                if (combinedStatsMap.has(stat.month)) {
                    combinedStatsMap.get(stat.month).registered = stat.registeredCount;
                }
            });
            classiqueSubs.forEach((stat) => {
                if (combinedStatsMap.has(stat.month)) {
                    combinedStatsMap.get(stat.month).classiqueActive = stat.count;
                }
            });
            cibleSubs.forEach((stat) => {
                if (combinedStatsMap.has(stat.month)) {
                    combinedStatsMap.get(stat.month).cibleActive = stat.count;
                }
            });

            // Convert map values to array and sort
            const combinedStats = Array.from(combinedStatsMap.values()).sort((a, b) => {
                const [yearA, monthA] = a.month.split('-').map(Number);
                const [yearB, monthB] = b.month.split('-').map(Number);
                if (yearA !== yearB) return yearA - yearB;
                return monthA - monthB;
            });

            return combinedStats;

        } catch (error) {
            log.error('Error getting monthly activity stats:', error);
            throw new Error('Failed to get monthly activity statistics.');
        }
    }

    /**
     * [Admin] Set or cancel a user's subscription.
     * - If newType is NONE, cancels all active subscriptions.
     * - If newType is CLASSIQUE or CIBLE, ensures an active subscription of that type exists,
     *   reactivating an expired/cancelled one or creating a new one if necessary.
     *   (Assumes a default duration, e.g., 30 days for reactivation/creation).
     */
    async adminSetSubscription(userId: string | Types.ObjectId, newType: SubscriptionType | 'NONE'): Promise<void> {
        log.info(`Admin request to set subscription for user ${userId} to ${newType}`);
        const userObjectId = new Types.ObjectId(userId.toString());
        const DEFAULT_SUB_DURATION_DAYS = 30; // Define default duration

        try {
            if (newType === 'NONE') {
                // Cancel all currently active subscriptions for the user
                const activeSubs = await subscriptionRepository.findActiveByUser(userObjectId);
                if (activeSubs.length > 0) {
                    const idsToCancel = activeSubs.map(sub => sub._id);
                    await subscriptionRepository.updateStatusMany(idsToCancel, SubscriptionStatus.CANCELLED);
                    log.info(`Admin cancelled ${idsToCancel.length} active subscription(s) for user ${userId}`);
                } else {
                    log.info(`Admin requested cancellation, but user ${userId} had no active subscriptions.`);
                }
            } else {
                // Setting to CLASSIQUE or CIBLE
                const targetType = newType; // CLASSIQUE or CIBLE

                // Check if an *active* sub of this type already exists
                const existingActiveSub = await subscriptionRepository.findActiveSubscriptionByType(userObjectId, targetType);
                if (existingActiveSub) {
                    log.info(`User ${userId} already has an active ${targetType} subscription. No action taken.`);
                    return; // Already active, nothing to do
                }

                // No active sub of this type, find *any* sub of this type (active, expired, cancelled)
                const existingSubsOfType = await subscriptionRepository.findByUser(userObjectId, targetType);

                let subToReactivate = existingSubsOfType.find(sub =>
                    sub.status === SubscriptionStatus.EXPIRED || sub.status === SubscriptionStatus.CANCELLED
                );

                const newEndDate = new Date();
                newEndDate.setDate(newEndDate.getDate() + DEFAULT_SUB_DURATION_DAYS);

                if (subToReactivate) {
                    // Reactivate the most recent inactive subscription
                    log.info(`Reactivating existing ${targetType} subscription ${subToReactivate._id} for user ${userId}`);
                    await subscriptionRepository.updateById(subToReactivate._id, {
                        status: SubscriptionStatus.ACTIVE,
                        endDate: newEndDate,
                        // Optionally reset startDate? Decided against for now.
                    });
                } else {
                    // No existing subscription of this type to reactivate, create a new one
                    log.info(`Creating new ${targetType} subscription for user ${userId}`);
                    await subscriptionRepository.create({
                        user: userObjectId,
                        subscriptionType: targetType,
                        endDate: newEndDate,
                        // startDate defaults to now
                    });
                }
            }
        } catch (error) {
            log.error(`Error setting subscription for user ${userId} to ${newType}:`, error);
            throw new Error('Failed to update user subscription.');
        }
    }

    // --- End Admin Specific Methods ---

    /**
     * Fetch specific details for a list of user IDs.
     * @param userIds - An array of user IDs to fetch details for.
     * @returns A promise that resolves to an array of user details (id, username, profilePicture).
     */
    async getUsersByIds(userIds: (string | Types.ObjectId)[]): Promise<UserDetails[]> {
        try {
            // Convert all userIds to ObjectId for consistency in the query
            const objectIds = userIds.map(id => typeof id === 'string' ? new Types.ObjectId(id) : id);
            const users = await userRepository.findDetailsByIds(objectIds);

            // Extract user IDs from the fetched user details to get partner statuses
            const fetchedUserIds = users.map(u => u._id); // Assuming UserDetails has _id as Types.ObjectId
            let partnerPackMap = new Map<string, 'silver' | 'gold'>();

            if (fetchedUserIds.length > 0) {
                // Ensure all IDs are ObjectIds before passing to the service method
                const objectIdsToFetch = fetchedUserIds.map(id => typeof id === 'string' ? new Types.ObjectId(id) : id);
                const activePartners = await partnerService.getActivePartnersByUserIds(objectIdsToFetch);
                activePartners.forEach(partner => {
                    partnerPackMap.set(partner.user.toString(), partner.pack);
                });
            }

            const usersWithPartnerPack = users.map(user => ({
                ...user,
                partnerPack: partnerPackMap.get(user._id.toString())
            }));

            return usersWithPartnerPack;
        } catch (error: any) {
            log.error(`Error fetching user details by IDs: ${error.message}`, { userIds });
            throw new Error('Failed to fetch user details');
        }
    }

    /**
     * [Internal] Finds user IDs by searching name, email, or phone number.
     * @param searchTerm - The term to search for.
     * @returns A promise resolving to an array of user ID strings.
     */
    async findUserIdsBySearchTerm(searchTerm: string): Promise<string[]> {
        log.info(`Searching user IDs for term: "${searchTerm}"`);
        if (!searchTerm || searchTerm.trim() === '') return [];

        const trimmedSearch = searchTerm.trim();
        const queryFilters: FilterQuery<IUser>[] = [];

        // Check if search term looks like a phone number (simple numeric check)
        const isNumeric = /^[\d\s()+-]+$/.test(trimmedSearch);
        if (isNumeric) {
            // Attempt to parse as number for exact match
            // Remove non-digit characters for potential matching
            const numericPhone = parseInt(trimmedSearch.replace(/\D/g, ''), 10);
            if (!isNaN(numericPhone)) {
                queryFilters.push({ phoneNumber: numericPhone });
            }
        }

        // Add regex search for name (case-insensitive)
        const searchRegex = new RegExp(trimmedSearch, 'i');
        queryFilters.push({ name: searchRegex });

        // Add regex search for email (case-insensitive)
        queryFilters.push({ email: searchRegex });

        // Combine filters with $or
        const finalQuery: FilterQuery<IUser> = {
            $or: queryFilters,
            // Ensure user is active/valid
            blocked: { $ne: true },
            deleted: { $ne: true },
            isVerified: true,
        };

        try {
            const userIds = await userRepository.findIdsBySearchTerm(finalQuery);
            log.info(`Found ${userIds.length} user IDs matching term "${searchTerm}"`);
            return userIds;
        } catch (error) {
            log.error(`Error finding user IDs by search term "${searchTerm}":`, error);
            // Throw error to be caught by controller
            throw new Error('Failed to search for users.');
        }
    }

    // --- NEW DASHBOARD METHOD ---
    /**
     * [Admin] Gathers data from multiple sources for the admin dashboard.
     */
    async adminGetDashboardData(): Promise<AdminDashboardData> {
        try {
            log.info('Fetching admin dashboard data...');

            const countryCodePrefixes: { [key: string]: string[] } = {
                'DZ': ['+213'], 'AO': ['+244'], 'BJ': ['+229'], 'BW': ['+267'],
                'BF': ['+226'], 'BI': ['+257'], 'CV': ['+238'], 'CM': ['+237'],
                'CF': ['+236'], 'TD': ['+235'], 'KM': ['+269'], 'CD': ['+243'],
                'CG': ['+242'], 'CI': ['+225'], 'DJ': ['+20'], 'EG': ['+240'],
                'GQ': ['+291'], 'ER': ['+268'], 'SZ': ['+251'], 'ET': ['+241'],
                'GA': ['+220'], 'GM': ['+233'], 'GH': ['+224'], 'GN': ['+245'],
                'GW': ['+254'], 'KE': ['+266'], 'LS': ['+231'], 'LR': ['+218'],
                'LY': ['+261'], 'MG': ['+265'], 'MW': ['+223'], 'ML': ['+222'],
                'MR': ['+230'], 'MU': ['+212'], 'MA': ['+258'], 'MZ': ['+264'],
                'NA': ['+227'], 'NE': ['+234'], 'NG': ['+250'], 'RW': ['+239'],
                'ST': ['+221'], 'SN': ['+248'], 'SC': ['+232'], 'SL': ['+252'],
                'SO': ['+27'], 'ZA': ['+211'], 'SS': ['+249'], 'SD': ['+255'],
                'TZ': ['+228'], 'TG': ['+216'], 'TN': ['+256'], 'UG': ['+260'],
                'ZM': ['+263'], 'ZW': ['+225']
            };

            const prefixToCountryCode: { [key: string]: string } = {};
            for (const country in countryCodePrefixes) {
                countryCodePrefixes[country].forEach(prefix => {
                    prefixToCountryCode[prefix] = country;
                });
            }

            log.info('Step 1: Fetching all users and other dashboard data');


            // --- Start Parallel Fetch ---
            const [
                // Local Data
                allUsers, // Still fetch for total count and balance by country
                totalSubCount, // Still count active subs

                // NEW: Aggregation for monthly user registrations
                monthlyAllUsersAgg,
                // NEW: Aggregation for monthly Classique subscriptions
                monthlyClassiqueSubsAgg,
                // NEW: Aggregation for monthly Cible subscriptions
                monthlyCibleSubsAgg,

                // External Data (unchanged, but now settingsService is used for adminBalance)
                adminBalance, // This will now come from settingsService
                totalTransactions,
                totalWithdrawals,
                totalRevenue,
                monthlyRevenue,
                activityOverviewData,
            ] = await Promise.all([
                // Fetch basic user data for counts and balances
                UserModel.find({ deleted: { $ne: true } })
                    .select('createdAt balance country phoneNumber _id')
                    .lean()
                    .exec(),
                SubscriptionModel.countDocuments({ status: SubscriptionStatus.ACTIVE }).exec(),

                // Aggregation for all monthly user registrations
                UserModel.aggregate([
                    { $match: { deleted: { $ne: true } } }, // Only count non-deleted users
                    {
                        $group: {
                            _id: {
                                year: { $year: '$createdAt' },
                                month: { $month: '$createdAt' }
                            },
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            month: {
                                $concat: [
                                    { $toString: '$_id.year' },
                                    '-',
                                    { $cond: { if: { $lt: ['$_id.month', 10] }, then: { $concat: ['0', { $toString: '$_id.month' }] }, else: { $toString: '$_id.month' } } }
                                ]
                            },
                            count: 1
                        }
                    },
                    { $sort: { month: 1 } }
                ]).exec(),

                // Aggregation for monthly Classique subscriptions
                SubscriptionModel.aggregate([
                    { $match: { subscriptionType: SubscriptionType.CLASSIQUE } }, // Filter by type
                    {
                        $group: {
                            _id: {
                                year: { $year: '$startDate' }, // Group by subscription start date
                                month: { $month: '$startDate' }
                            },
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            month: {
                                $concat: [
                                    { $toString: '$_id.year' },
                                    '-',
                                    { $cond: { if: { $lt: ['$_id.month', 10] }, then: { $concat: ['0', { $toString: '$_id.month' }] }, else: { $toString: '$_id.month' } } }
                                ]
                            },
                            count: 1
                        }
                    },
                    { $sort: { month: 1 } }
                ]).exec(),

                // Aggregation for monthly Cible subscriptions
                SubscriptionModel.aggregate([
                    { $match: { subscriptionType: SubscriptionType.CIBLE } }, // Filter by type
                    {
                        $group: {
                            _id: {
                                year: { $year: '$startDate' }, // Group by subscription start date
                                month: { $month: '$startDate' }
                            },
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            month: {
                                $concat: [
                                    { $toString: '$_id.year' },
                                    '-',
                                    { $cond: { if: { $lt: ['$_id.month', 10] }, then: { $concat: ['0', { $toString: '$_id.month' }] }, else: { $toString: '$_id.month' } } }
                                ]
                            },
                            count: 1
                        }
                    },
                    { $sort: { month: 1 } }
                ]).exec(),

                // External Service Calls
                settingsService.getAdminBalance(), // NEW: Fetch admin balance from settings-service
                paymentService.getTotalTransactions(),
                paymentService.getTotalWithdrawals(),
                paymentService.getTotalRevenue(),
                paymentService.getMonthlyRevenue(),
                paymentService.getActivityOverview(),
            ]);
            // --- End Parallel Fetch ---



            log.info('Step 2: Processing fetched data');


            // --- Process Fetched Data ---
            const totalUsersCount = allUsers.length;

            // `allUsersDates`, `classiqueSubStartDates`, `cibleSubStartDates` are no longer needed here,
            // as the aggregated data is used directly.

            // Calculate Balances by Country (unchanged logic)
            const balancesByCountry: { [countryCode: string]: number } = {};
            allUsers.forEach((user: Pick<FlattenMaps<IUser>, '_id' | 'balance' | 'country' | 'phoneNumber'>) => {
                let countryCode = 'Autres'; // Default
                const userCountryUpper = typeof user.country === 'string' ? user.country.toUpperCase() : undefined;

                if (userCountryUpper && countryCodePrefixes[userCountryUpper]) {
                    countryCode = userCountryUpper;
                } else if (user.phoneNumber) {
                    const phoneStr = user.phoneNumber.toString(); // Ensure it's a string
                    // Check prefixes (simple startsWith)
                    for (const prefix in prefixToCountryCode) {
                        if (phoneStr.startsWith(prefix)) {
                            countryCode = prefixToCountryCode[prefix];
                            break;
                        }
                    }
                }

                balancesByCountry[countryCode] = (balancesByCountry[countryCode] || 0) + (user.balance || 0);
            });

            const dashboardData: AdminDashboardData = {
                adminBalance,
                count: totalUsersCount,
                subCount: totalSubCount,
                monthlyAllUsers: monthlyAllUsersAgg,
                monthlyClassiqueSubs: monthlyClassiqueSubsAgg,
                monthlyCibleSubs: monthlyCibleSubsAgg,
                totalTransactions,
                totalWithdrawals,
                totalRevenue,
                monthlyRevenue: monthlyRevenue,
                balancesByCountry: balancesByCountry,
                activityOverview: activityOverviewData
            };
            // --- End Data Processing ---

            log.info('Step 3: Dashboard data processed successfully');


            log.info('Successfully gathered admin dashboard data.');
            return dashboardData;

        } catch (error: any) {
            log.error('Error fetching admin dashboard data:', error);
            // Re-throw specific errors if they are AppErrors, otherwise create a new one
            if (error instanceof AppError) {
                throw error;
            }
            throw new Error(`Failed to fetch admin dashboard data: ${error.message}`);
        }
    }
    // --- End NEW DASHBOARD METHOD ---

    /**
     * Uploads an avatar, updates user profile.
     */
    async updateAvatar(
        userId: string | Types.ObjectId,
        fileBuffer: Buffer,
        mimeType: string,
        originalName: string
    ): Promise<Partial<IUser>> { // Return Partial<IUser> to include avatar URL
        log.info(`Updating avatar for user ${userId}`);
        try {
            // 1. Upload to Settings Service, specifying the folder
            const uploadResult = await settingsService.uploadFile(
                fileBuffer,
                mimeType,
                originalName,
                'profile-picture' // Specify the target folder name
            );
            const fileId = uploadResult.fileId;

            // 2. Construct Proxy URL
            // Use relative path which will be resolved based on where user-service is mounted
            const proxyUrl = `/settings/files/${fileId}`; // Relative URL pointing to settings-service proxy

            // 3. Update User Document
            const updatedUser = await userRepository.updateById(userId, {
                avatar: proxyUrl,
                avatarId: fileId // Store the original file ID if needed
            });

            if (!updatedUser) {
                // TODO: Consider deleting the uploaded file from settings-service if user update fails
                throw new AppError('User not found after avatar upload', 404);
            }

            log.info(`Avatar updated successfully for user ${userId}. New URL: ${proxyUrl}`);
            // Return only the necessary updated fields or the mapped response
            return this.mapUserToResponse(updatedUser); // Ensure avatar field is included

        } catch (error) {
            log.error(`Failed to update avatar for user ${userId}:`, error);
            // Re-throw specific AppErrors or a generic one
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to update avatar', 500);
        }
    }

    /**
     * Gets the avatar file stream from settings service.
     */
    async getAvatarStream(fileId: string): Promise<{ stream: NodeJS.ReadableStream; contentType?: string }> {
        log.info(`Fetching avatar stream for fileId: ${fileId}`);
        try {
            // TODO: Get content type along with stream from settings service if possible
            // For now, we assume the settings service might set it, or we guess based on common types
            // Or, ideally, store contentType when uploading.
            const stream = await settingsService.getFileStream(fileId);
            // Placeholder for content type - ideally get from settings-service or stored metadata
            const contentType = 'image/jpeg'; // Replace with actual logic if possible

            return { stream, contentType };
        } catch (error) {
            log.error(`Failed to get avatar stream for fileId ${fileId}:`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to retrieve avatar stream', 500);
        }
    }

    /**
     * Retrieves a public user profile, containing only non-sensitive information.
     * Respects the user's shareContactInfo preference.
     * @param userId The ID of the user to retrieve.
     * @returns Public user profile or null if not found, deleted, blocked, or sharing disabled.
     */
    async getPublicUserProfile(userId: string): Promise<IPublicUserProfileResponse | null> {
        log.info(`Getting public profile for user ${userId}`);
        const user = await userRepository.findById(userId);

        // Check if user exists and is suitable for public view
        if (!user || user.deleted || user.blocked) {
            log.warn(`Public profile requested for non-existent, deleted, or blocked user: ${userId}`);
            return null; // Return null if user not found, deleted, or blocked
        }

        // Check sharing preference
        if (!user.shareContactInfo) {
            log.warn(`User ${userId} has disabled contact info sharing. Returning minimal public profile.`);
            // Return minimal info if sharing is disabled
            return {
                _id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                phoneNumber: user.phoneNumber,
                country: user.country,
                city: user.city,
                region: user.region,
            };
        }

        log.info(`User ${userId} allows sharing. Returning extended public profile.`);
        // User exists, is valid, and allows sharing - map to public response
        const publicProfile: IPublicUserProfileResponse = {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            country: user.country,
            region: user.region,
            city: user.city,
            sex: user.sex,
            birthDate: user.birthDate,
            language: user.language,
            interests: user.interests,
            profession: user.profession,
            createdAt: user.createdAt,
        };

        return publicProfile;
    }

    /**
     * Resends an OTP code to the user's registered email.
     * @param email - The email address of the user.
     * @param purpose - The reason for requesting the OTP (e.g., 'login', 'register', 'forgotPassword').
     * @returns Promise<void>
     */
    async resendOtp(email: string, purpose: 'login' | 'register' | 'forgotPassword' | 'changeEmail' | string): Promise<void> {
        log.info(`OTP resend requested for email: ${email}, purpose: ${purpose}`);

        const user = await userRepository.findByEmail(email);

        // IMPORTANT: Do not confirm if the user exists to prevent email enumeration attacks.
        // If user exists, proceed with OTP generation and sending.
        if (user && !user.blocked && !user.deleted) { // Only send if user is active
            try {
                // Generate and store a new general-purpose OTP
                const otpCode = await this.generateAndStoreOtp(user._id, 'otps');

                // Send OTP via notification service
                // The notification service might internally adjust the message based on purpose
                await notificationService.sendOtp({
                    userId: user._id.toString(),
                    recipient: user.email,
                    channel: DeliveryChannel.EMAIL,
                    code: otpCode,
                    expireMinutes: 10, // Standard expiration
                    isRegistration: purpose === 'register', // Set based on purpose
                    purpose: purpose, // Pass the purpose directly
                    userName: user.name
                });

                log.info(`Resent OTP successfully for email: ${email}`);

            } catch (error) {
                log.error(`Failed to resend OTP for email ${email}:`, error);
                // Log the error but don't throw it back to the controller to avoid revealing info.
                // The controller will return a generic success message regardless.
            }
        } else {
            log.warn(`OTP resend requested for non-existent or inactive user: ${email}. No action taken.`);
            // No error thrown, just log internally.
        }
        // Always return void, regardless of user existence or OTP sending success.
    }

    /**
     * Sends an OTP for password reset purposes.
     * @param email - The email address of the user requesting the reset.
     * @returns Promise<void>
     */
    async requestPasswordResetOtp(email: string): Promise<void> {
        const purpose = 'forgotPassword';
        log.info(`Password reset OTP requested for email: ${email}`);

        const user = await userRepository.findByEmail(email);

        // IMPORTANT: Do not confirm if the user exists.
        if (user && !user.blocked && !user.deleted) {
            try {
                const otpCode = await this.generateAndStoreOtp(user._id, 'otps');
                await notificationService.sendOtp({
                    userId: user._id.toString(),
                    recipient: user.email,
                    channel: DeliveryChannel.EMAIL,
                    code: otpCode,
                    expireMinutes: 10,
                    isRegistration: false, // Added missing property
                    purpose: purpose,
                    userName: user.name
                });
                log.info(`Password reset OTP sent successfully for email: ${email}`);
            } catch (error) {
                log.error(`Failed to send password reset OTP for email ${email}:`, error);
                throw error;
            }
        } else {
            log.warn(`Password reset OTP requested for non-existent or inactive user: ${email}. No action taken.`);
            throw new AppError('User not found or inactive.', 404);
        }
    }

    /**
     * Sends an OTP to a *new* email address to verify an email change request.
     * Requires the user to be authenticated.
     * @param userId - The ID of the authenticated user requesting the change.
     * @param newEmail - The new email address to verify.
     * @returns Promise<void>
     */
    async requestChangeEmailOtp(userId: string | Types.ObjectId, newEmail: string): Promise<void> {
        const purpose = 'changeEmail';
        log.info(`Change email OTP requested for user ${userId} to new email: ${newEmail}`);

        // 1. Validate new email format
        if (!newEmail || typeof newEmail !== 'string' || !this.isValidEmailDomain(newEmail)) {
            throw new AppError('Invalid new email address format or domain.', 400);
        }

        // 2. Check if new email is already in use by *another* user
        const existingUserWithNewEmail = await userRepository.findByEmail(newEmail);
        if (existingUserWithNewEmail && existingUserWithNewEmail._id.toString() !== userId.toString()) {
            throw new AppError('This email address is already associated with another account.', 409); // 409 Conflict
        }

        // 3. Get current user details (for username in notification)
        const currentUser = await userRepository.findById(userId);
        if (!currentUser || currentUser.blocked || currentUser.deleted) {
            // This shouldn't happen if the user is authenticated, but check anyway.
            throw new AppError('User account is inactive or not found.', 403);
        }

        // 4. Generate and store OTP for the *current* user
        const otpCode = await this.generateAndStoreOtp(currentUser._id, 'otps');

        // 5. Send OTP to the *new* email address
        await notificationService.sendOtp({
            userId: currentUser._id.toString(),
            recipient: newEmail, // Send to the NEW email
            channel: DeliveryChannel.EMAIL,
            code: otpCode,
            expireMinutes: 10,
            isRegistration: false, // Added missing property
            purpose: purpose,
            userName: currentUser.name // Use current user's name
        });

        log.info(`Change email OTP sent successfully to ${newEmail} for user ${userId}`);
        // No error thrown if notification fails, handled by notificationService client
    }

    /**
     * Resets the user's password after verifying the forgot password OTP.
     * @param email - The user's email address.
     * @param otpCode - The OTP code received for password reset.
     * @param newPassword - The new password to set.
     * @returns Promise<void>
     */
    async resetPassword(email: string, otpCode: string, newPassword: string): Promise<void> {
        log.info(`Password reset attempt for email: ${email}`);

        if (!email || !otpCode || !newPassword) {
            throw new AppError('Email, OTP, and new password are required.', 400);
        }

        // 1. Find user by email
        // Note: Unlike request, here we NEED the user to exist to reset the password.
        const user = await userRepository.findByEmail(email);
        if (!user) {
            // Still use a generic error to avoid confirming email existence
            throw new AppError('Invalid OTP or email.', 400);
        }
        if (user.blocked || user.deleted) {
            throw new AppError('Account is inactive.', 403);
        }


        // 2. Validate the OTP (using the general 'otps' field)
        const now = new Date();
        const matchingOtp = user.otps.find(otp => otp.code === otpCode && otp.expiration > now);

        if (!matchingOtp) {
            log.warn(`Invalid or expired password reset OTP for email: ${email}`);
            // Optional: Implement attempt limiting logic here
            throw new AppError('Invalid or expired OTP.', 400);
        }

        // 3. OTP is valid, clear *all* general OTPs for security
        await userRepository.clearOtps(user._id, 'otps');

        // 4. REMOVED: Hash the new password (Handled by pre-save hook)
        // const hashedPassword = await bcrypt.hash(newPassword, config.saltRounds);

        // 5. Update the password in the repository (send plain password, hook will hash)
        // await userRepository.updateById(user._id, { password: newPassword });

        // Manually normalize the sex field since pre-save hook is not executing
        if (user.sex && typeof user.sex === 'string') {
            const originalSex = user.sex;
            const lowercasedSex = user.sex.toLowerCase();
            if (user.sex !== lowercasedSex) {
                console.log(`[DEBUG] resetPassword: Manually normalizing sex from "${originalSex}" to "${lowercasedSex}"`);
                user.sex = lowercasedSex as any; // Cast to any to avoid TS errors
            }
        }

        // 5. Set the new password and save the user document to trigger the pre-save hook
        user.password = newPassword;
        await user.save();

        // 6. Optional: Invalidate existing login tokens/sessions if any
        await userRepository.updateById(user._id, { token: undefined });

        log.info(`Password successfully reset for email: ${email}`);

        // Optional: Send confirmation email?
        // await notificationService.sendPasswordResetConfirmation(user.id, user.email, user.name);
    }

    /**
     * Confirms an email change request after verifying the OTP sent to the new email.
     * Requires the user to be authenticated.
     * @param userId - The ID of the authenticated user.
     * @param newEmail - The new email address that was previously requested.
     * @param otpCode - The OTP code received at the new email address.
     * @returns Promise<void>
     */
    async confirmChangeEmail(userId: string | Types.ObjectId, newEmail: string, otpCode: string): Promise<void> {
        log.info(`Confirming email change for user ${userId} to new email: ${newEmail}`);

        if (!newEmail || !otpCode) {
            throw new AppError('New email and OTP are required.', 400);
        }

        // 1. Find the currently authenticated user
        const user = await userRepository.findById(userId);
        if (!user || user.blocked || user.deleted) {
            throw new AppError('User account is inactive or not found.', 403);
        }

        // 2. Validate the OTP stored against the *current* user
        const now = new Date();
        const matchingOtp = user.otps.find(otp => otp.code === otpCode && otp.expiration > now);

        if (!matchingOtp) {
            log.warn(`Invalid or expired email change OTP for user: ${userId}`);
            throw new AppError('Invalid or expired OTP.', 400);
        }

        // 3. Check *again* if the new email is already in use by *another* user (race condition check)
        if (!this.isValidEmailDomain(newEmail)) {
            throw new AppError('Invalid new email address format or domain.', 400);
        }
        const existingUserWithNewEmail = await userRepository.findByEmail(newEmail);
        if (existingUserWithNewEmail && existingUserWithNewEmail._id.toString() !== userId.toString()) {
            // Clear the OTP even if the email is taken now, to prevent reuse
            await userRepository.clearOtps(user._id, 'otps');
            throw new AppError('This email address has been taken by another account since the request was made.', 409);
        }

        // 4. OTP is valid and email is available. Clear *all* general OTPs.
        await userRepository.clearOtps(user._id, 'otps');

        // 5. Update the user's email address
        await userRepository.updateById(user._id, { email: newEmail });

        log.info(`Email address successfully changed to ${newEmail} for user ${userId}`);

        // Optional: Send confirmation to the *old* email address?
        // await notificationService.sendEmailChangeConfirmation(user.id, user.email /* old email */, newEmail, user.name);
    }

    /**
     * Check if a user exists by email or phone number.
     * Used for registration forms to check availability.
     * @param email - Optional email address.
     * @param phoneNumber - Optional phone number.
     * @returns True if a user with either the email or phone exists, false otherwise.
     */
    async checkExistence(
        email?: string,
        phoneNumber?: string
    ): Promise<boolean> {
        log.info(`Checking user existence for email: ${email}, phone: ${phoneNumber}`);
        if (!email && !phoneNumber) {
            throw new AppError('Email or phone number must be provided.', 400);
        }

        try {
            let normalizedEmail = email?.trim();
            let cleanedPhoneNumber = phoneNumber ? phoneNumber.replace(/\D/g, '') : undefined;

            // Call the repository method that checks for both email or phone
            const user = await userRepository.findByEmailOrPhone(normalizedEmail, cleanedPhoneNumber);

            const exists = !!user; // Convert user object existence to boolean
            log.info(`Existence check result for email: ${email}, phone: ${phoneNumber} is ${exists}`);
            return exists;

        } catch (error: any) {
            log.error(`Error during existence check: ${error.message}`, { email, phoneNumber });
            // Rethrow database errors or unexpected errors as an AppError
            throw new AppError('An error occurred during the existence check.', 500);
        }
    }
}

// Export an instance
export const userService = new UserService(); 