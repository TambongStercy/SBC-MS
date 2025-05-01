import UserModel, { IUser } from '../models/user.model';
import SubscriptionModel, { ISubscription, SubscriptionStatus, SubscriptionType } from '../models/subscription.model';
import mongoose, { Types, FilterQuery } from 'mongoose';
import { ContactSearchFilters, ContactSearchResponse } from '../../types/contact.types';
import log from '../../utils/logger';

// Interface for specific user details needed by other services
export interface UserDetails {
    _id: Types.ObjectId | string;
    name: string;          // Changed from username
    email?: string;         // Added email
    phoneNumber?: string;   // Changed from string to number (matching model)
    avatar?: string;        // Changed from profilePicture
}

// Interface for OTP data structure (matching the subdocument schema)
interface IOtpData {
    code: string;
    expiration: Date;
}

// Interface for IP data structure
interface IIpData {
    ipAddress?: string;
    ipCity?: string;
    ipRegion?: string;
    ipCountry?: string;
    ipLocation?: string;
    ipOrg?: string;
    ipLastUpdated?: Date;
}

export class UserRepository {

    /**
     * Creates a new user document.
     * @param userData - Data for the new user.
     * @returns The newly created user document.
     */
    async create(userData: Partial<IUser>): Promise<IUser> {
        const user = new UserModel(userData);
        // Password hashing is handled by the pre-save hook in the model
        return user.save();
    }

    /**
     * Finds a user by their email address.
     * Optionally selects the password field.
     * @param email - The email to search for.
     * @param selectPassword - Whether to include the password field in the result.
     * @returns The user document or null if not found.
     */
    async findByEmail(email: string, selectPassword = false): Promise<IUser | null> {
        const query = UserModel.findOne({ email });
        if (selectPassword) {
            query.select('+password');
        }
        return query.exec();
    }

    /**
     * Finds a user by their phone number.
     * @param phoneNumber - The phone number to search for.
     * @returns The user document or null if not found.
     */
    async findByPhoneNumber(phoneNumber: string): Promise<IUser | null> {
        return UserModel.findOne({ phoneNumber }).exec();
    }

    /**
     * Finds a user by their ID.
     * @param userId - The ID of the user.
     * @returns The user document or null if not found.
     */
    async findById(userId: string | Types.ObjectId): Promise<IUser | null> {
        return UserModel.findById(userId).exec();
    }

    /**
     * Finds a user by their ID, excluding soft-deleted users.
     * @param userId - The ID of the user.
     * @returns The user document or null if not found or soft-deleted.
     */
    async findByIdNotDeleted(userId: string | Types.ObjectId): Promise<IUser | null> {
        return UserModel.findOne({ _id: userId, deleted: { $ne: true } }).exec();
    }

    /**
     * Finds a user by either email or phone number.
     * Useful for checking duplicates during registration.
     * @param email - The email address.
     * @param phoneNumber - The phone number.
     * @returns The user document or null if none found.
     */
    async findByEmailOrPhone(email: string, phoneNumber: string): Promise<IUser | null> {
        return UserModel.findOne({ $or: [{ email }, { phoneNumber }] }).exec();
    }

    /**
     * Finds a user by their referral code.
     * @param referralCode - The referral code to search for.
     * @returns The user document or null if not found.
     */
    async findByReferralCode(referralCode: string): Promise<IUser | null> {
        return UserModel.findOne({ referralCode, deleted: { $ne: true } }).exec(); // Ensure referrer is not deleted
    }

    /**
     * Updates a user by their ID.
     * @param userId - The ID of the user to update.
     * @param updateData - The fields to update.
     * @returns The updated user document or null if not found.
     */
    async updateById(userId: string | Types.ObjectId, updateData: Partial<IUser>): Promise<IUser | null> {
        // { new: true } returns the modified document rather than the original
        return UserModel.findByIdAndUpdate(userId, updateData, { new: true }).exec();
    }

    /**
     * Atomically updates the balance for a user.
     * @param userId - The ID of the user.
     * @param amountChange - The amount to add (positive) or subtract (negative).
     * @returns The updated user document or null.
     */
    async updateBalance(userId: string | Types.ObjectId, amountChange: number): Promise<IUser | null> {
        return UserModel.findByIdAndUpdate(
            userId,
            { $inc: { balance: amountChange } }, // Use $inc for atomic update
            { new: true } // Return the updated document
        ).exec();
    }

    /**
     * Adds an OTP to the specified array for a user.
     * @param userId - The ID of the user.
     * @param otpType - 'otps' or 'contactsOtps'.
     * @param otpData - The OTP object { code, expiration }.
     * @returns The updated user document or null.
     */
    async addOtp(userId: string | Types.ObjectId, otpType: 'otps' | 'contactsOtps', otpData: IOtpData): Promise<IUser | null> {
        const update = { $push: { [otpType]: otpData } };
        return UserModel.findByIdAndUpdate(userId, update, { new: true }).exec();
    }

    /**
     * Clears all OTPs of a specific type for a user.
     * @param userId - The ID of the user.
     * @param otpType - 'otps' or 'contactsOtps'.
     * @returns The updated user document or null.
     */
    async clearOtps(userId: string | Types.ObjectId, otpType: 'otps' | 'contactsOtps'): Promise<IUser | null> {
        const update = { $set: { [otpType]: [] } }; // Set the array to empty
        return UserModel.findByIdAndUpdate(userId, update, { new: true }).exec();
    }

    /**
     * Clears all expired OTPs for a user.
     * @param userId - The ID of the user.
     * @returns The updated user document or null.
     */
    async clearExpiredOtps(userId: string | Types.ObjectId): Promise<IUser | null> {
        const now = new Date();
        const update = {
            $pull: {
                otps: { expiration: { $lte: now } },
                contactsOtps: { expiration: { $lte: now } },
            }
        };
        return UserModel.findByIdAndUpdate(userId, update, { new: true }).exec();
    }

    /**
     * Updates the daily withdrawal count and amount for a specific date.
     * Creates the array element if it doesn't exist for the date.
     * @param userId - The ID of the user.
     * @param dateString - The date in 'YYYY-MM-DD' format.
     * @param countIncrement - The amount to increment the count by (usually 1).
     * @param amountIncrement - The amount to increment the totalAmount by.
     * @returns The updated user document or null.
     */
    async updateDailyWithdrawal(userId: string | Types.ObjectId, dateString: string, countIncrement: number, amountIncrement: number): Promise<IUser | null> {
        // This requires two steps: first ensure the element exists, then increment
        // Step 1: Add the element with default values if it doesn't exist for the date
        await UserModel.updateOne(
            { _id: userId, 'dailyWithdrawals.date': { $ne: dateString } },
            { $push: { dailyWithdrawals: { date: dateString, count: 0, totalAmount: 0 } } }
        ).exec();

        // Step 2: Increment the values for the specific date
        return UserModel.findOneAndUpdate(
            { _id: userId, 'dailyWithdrawals.date': dateString },
            {
                $inc: {
                    'dailyWithdrawals.$.count': countIncrement,
                    'dailyWithdrawals.$.totalAmount': amountIncrement,
                },
            },
            { new: true } // Return the updated document
        ).exec();
    }

    /**
     * Updates IP address information for a user.
     * @param userId - The ID of the user.
     * @param ipData - An object containing IP fields to update.
     * @returns The updated user document or null.
     */
    async updateIpAddress(userId: string | Types.ObjectId, ipData: IIpData): Promise<IUser | null> {
        // Construct the update object carefully to avoid overwriting fields unintentionally
        const updateFields: Partial<IUser> = {};
        if (ipData.ipAddress !== undefined) updateFields.ipAddress = ipData.ipAddress;
        if (ipData.ipCity !== undefined) updateFields.ipCity = ipData.ipCity;
        if (ipData.ipRegion !== undefined) updateFields.ipRegion = ipData.ipRegion;
        if (ipData.ipCountry !== undefined) updateFields.ipCountry = ipData.ipCountry;
        if (ipData.ipLocation !== undefined) updateFields.ipLocation = ipData.ipLocation;
        if (ipData.ipOrg !== undefined) updateFields.ipOrg = ipData.ipOrg;
        updateFields.ipLastUpdated = ipData.ipLastUpdated || new Date(); // Set last updated time

        return UserModel.findByIdAndUpdate(userId, { $set: updateFields }, { new: true }).exec();
    }

    /**
     * Soft deletes a user by setting the deleted flag and timestamp.
     * @param userId - The ID of the user to soft delete.
     * @param reason - Optional reason for deletion.
     * @returns The updated user document or null.
     */
    async softDeleteById(userId: string | Types.ObjectId, reason?: string): Promise<IUser | null> {
        const updateData: Partial<IUser> = {
            deleted: true,
            deletedAt: new Date(),
            token: undefined, // Clear token on delete
        };
        if (reason) {
            updateData.deletionReason = reason;
        }
        return this.updateById(userId, updateData);
    }

    /**
     * Restores a soft-deleted user.
     * @param userId - The ID of the user to restore.
     * @returns The updated user document or null.
     */
    async restoreById(userId: string | Types.ObjectId): Promise<IUser | null> {
        const updateData: Partial<IUser> = {
            deleted: false,
            deletedAt: undefined,
            deletionReason: undefined,
        };
        // Use findOneAndUpdate to ensure we only restore if currently deleted
        return UserModel.findOneAndUpdate({ _id: userId, deleted: true }, updateData, { new: true }).exec();
    }

    /**
     * Finds a user by their ID and ensures the provided token matches the stored one.
     * Useful for validating tokens during authentication if storing them.
     * @param userId - The ID of the user.
     * @param token - The token to validate against the stored token.
     * @returns The user document or null if not found, deleted, or token doesn't match.
     */
    async findByIdAndValidateToken(userId: string | Types.ObjectId, token: string): Promise<IUser | null> {
        return UserModel.findOne({ _id: userId, token: token, deleted: { $ne: true } }).exec();
    }

    /**
     * Finds all users matching a list of IDs.
     * @param userIds - Array of user IDs.
     * @returns An array of user documents.
     */
    async findAllByIds(userIds: (string | Types.ObjectId)[]): Promise<IUser[]> {
        return UserModel.find({ _id: { $in: userIds }, deleted: { $ne: true } }).exec();
    }

    /**
     * Finds users who do not have an active subscription of specific types.
     * Uses MongoDB aggregation pipeline.
     * @param subscriptionTypes - An array of SubscriptionType enums to exclude.
     * @returns A promise resolving to an array of user documents (basic info only).
     */
    async findUsersWithoutActiveSubscriptionType(subscriptionTypes: SubscriptionType[]): Promise<any[]> {
        const now = new Date();

        const pipeline = [
            // Step 1: Look up subscriptions for each user
            {
                $lookup: {
                    from: SubscriptionModel.collection.name, // Use the actual collection name
                    localField: '_id',
                    foreignField: 'user',
                    as: 'subscriptions'
                }
            },
            // Step 2: Filter users who DO NOT have an ACTIVE subscription of the specified types
            {
                $match: {
                    // Ensure the user is not soft-deleted
                    deleted: { $ne: true },
                    // Match users where NONE of their subscriptions meet the criteria
                    subscriptions: {
                        $not: {
                            $elemMatch: {
                                subscriptionType: { $in: subscriptionTypes },
                                status: SubscriptionStatus.ACTIVE,
                                endDate: { $gt: now } // Ensure it's currently active
                            }
                        }
                    }
                }
            },
            // Step 3: Project only necessary user fields (optional, but good practice)
            {
                $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    phoneNumber: 1,
                    createdAt: 1
                    // Add other fields needed for the export
                }
            }
        ];

        return UserModel.aggregate(pipeline).exec();
    }

    /**
     * Generic find method for users based on a query and options.
     * @param query - Mongoose filter query.
     * @param options - Options like limit, skip, sort, select.
     * @returns An array of user documents.
     */
    async find(query: mongoose.FilterQuery<IUser>, options: {
        limit?: number;
        skip?: number;
        sort?: any;
        select?: string;
    } = {}): Promise<IUser[]> {
        let findQuery = UserModel.find(query);

        if (options.sort) {
            findQuery = findQuery.sort(options.sort);
        }
        if (options.skip) {
            findQuery = findQuery.skip(options.skip);
        }
        if (options.limit) {
            findQuery = findQuery.limit(options.limit);
        }
        if (options.select) {
            findQuery = findQuery.select(options.select) as any;
        }

        // Execute the potentially modified query and cast the lean result
        const results = await findQuery.lean().exec();

        // Perform the final cast here. This tells TS to trust us that the lean objects match IUser[]
        return results as unknown as IUser[];
    }

    /**
     * Generic count method for users based on a query.
     * @param query - Mongoose filter query.
     * @returns The number of documents matching the query.
     */
    async countDocuments(query: mongoose.FilterQuery<IUser>): Promise<number> {
        return UserModel.countDocuments(query).exec();
    }

    /**
     * Finds specific details (ID, username, profile picture) for multiple users by their IDs.
     * Excludes soft-deleted users.
     * @param userIds - An array of user IDs.
     * @returns A promise resolving to an array of user details objects.
     */
    async findDetailsByIds(userIds: (string | Types.ObjectId)[]): Promise<UserDetails[]> {
        return UserModel.find({
            _id: { $in: userIds },
            deleted: { $ne: true } // Ensure user is not soft-deleted
        })
            .select('_id name email phoneNumber avatar') // Select fields matching the updated UserDetails interface
            .lean() // Use lean for performance as we only need plain objects
            .exec();
    }

    /**
     * Finds user IDs matching a given query.
     * @param query - Mongoose filter query (likely using $or for search).
     * @returns An array of user ID strings.
     */
    async findIdsBySearchTerm(query: FilterQuery<IUser>): Promise<string[]> {
        try {
            // Ensure the base query includes non-deleted/non-blocked if not already present
            const finalQuery = {
                ...query,
                deleted: query.deleted ?? { $ne: true },
                blocked: query.blocked ?? { $ne: true },
            };

            const users = await UserModel.find(finalQuery)
                .select('_id') // Select only the ID field
                .lean()      // Use lean for performance
                .exec();

            // Map the results to an array of strings
            return users.map((user: { _id: Types.ObjectId }) => user._id.toString());
        } catch (error: any) {
            log.error(`Error finding user IDs by search term: ${error.message}`, { query });
            throw error; // Re-throw for service layer to handle
        }
    }

    // --- Add other necessary repository methods --- 
    // e.g., for handling OTPs, soft deletes, balance updates, referral codes etc.
    // These might involve more complex queries or updates.

    // Example for soft delete (implementation depends on exact strategy)
    // async softDelete(userId: string): Promise<IUser | null> {
    //     return this.updateById(userId, { deleted: true, deletedAt: new Date() });
    // }

    // Example for finding non-deleted user
    // async findByIdNotDeleted(userId: string): Promise<IUser | null> {
    //     return UserModel.findOne({ _id: userId, deleted: { $ne: true } }).exec();
    // }
}

// Export an instance for easy use, or allow instantiation
export const userRepository = new UserRepository(); 