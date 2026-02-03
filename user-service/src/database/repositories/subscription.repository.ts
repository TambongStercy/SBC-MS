import SubscriptionModel, { ISubscription, SubscriptionStatus, SubscriptionType, SubscriptionCategory } from '../models/subscription.model';
import mongoose, { Types, UpdateWriteOpResult } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('SubscriptionRepository');

// Interface for data needed to create a subscription
interface ISubscriptionCreationData {
    user: Types.ObjectId;
    subscriptionType: SubscriptionType;
    startDate?: Date; // Optional, defaults to now
    endDate: Date;    // Required
    metadata?: Record<string, any>;
}

// Define document type
// type SubscriptionDocument = Document<unknown, {}, ISubscription> & ISubscription & { _id: Types.ObjectId };
// Let's remove or comment out the specific Document type for now as it causes issues with Mongoose return types

// Define pagination response interface
export interface SubscriptionPaginationResponse {
    subscriptions: any[]; // Use any to bypass type issues
    totalCount: number;
    totalPages: number;
    page: number;
}

/**
 * Repository class for managing subscription data
 * This is a placeholder implementation that would be expanded
 * with actual subscription functionality in the future
 */
export class SubscriptionRepository {

    /**
     * Creates a new subscription record.
     * @param data - Data for the new subscription.
     * @returns The newly created subscription document.
     */
    async create(data: Omit<ISubscriptionCreationData, 'planIdentifier'>): Promise<any> {
        const subscription = new SubscriptionModel({
            ...data,
            status: SubscriptionStatus.ACTIVE, // Ensure status is active on creation
            startDate: data.startDate || new Date(), // Default start date to now
        });
        return subscription.save();
    }

    /**
     * Finds a subscription by its ID.
     * @param subscriptionId - The ID of the subscription.
     * @returns The subscription document or null.
     */
    async findById(subscriptionId: string | Types.ObjectId): Promise<any | null> {
        return SubscriptionModel.findById(subscriptionId).exec();
    }

    /**
     * Finds all subscriptions for a given user.
     * @param userId - The ID of the user.
     * @param filterByType - Optional subscription type to filter by.
     * @returns An array of subscription documents.
     */
    async findByUser(userId: string | Types.ObjectId, filterByType?: SubscriptionType): Promise<any[]> {
        const query: mongoose.FilterQuery<ISubscription> = { user: userId };
        if (filterByType) {
            query.subscriptionType = filterByType;
        }
        return SubscriptionModel.find(query).exec();
    }

    /**
     * Finds all *active* subscriptions for a given user.
     * Active means status is ACTIVE and endDate is in the future.
     * @param userId - The ID of the user.
     * @param filterByType - Optional subscription type to filter by.
     * @returns An array of active subscription documents.
     */
    async findActiveByUser(userId: string | Types.ObjectId, filterByType?: SubscriptionType): Promise<any[]> {
        const now = new Date();
        const query: mongoose.FilterQuery<ISubscription> = {
            user: userId,
            status: SubscriptionStatus.ACTIVE,
            endDate: { $gt: now }, // End date must be in the future
        };
        if (filterByType) {
            query.subscriptionType = filterByType;
        }
        return SubscriptionModel.find(query).sort({ endDate: -1 }).exec(); // Sort by newest expiration first
    }

    /**
     * Check if a user has an active subscription of any type
     * @param userId The user ID to check
     * @returns Boolean indicating if an active subscription exists
     */
    async hasActiveSubscription(userId: string): Promise<boolean> {
        // Placeholder implementation
        return true;
    }

    /**
     * Check if a user has a specific subscription type
     * @param userId The user ID to check
     * @param subscriptionType The type of subscription to check for
     * @returns Boolean indicating if the specified subscription is active
     */
    async hasSubscriptionType(userId: string, subscriptionType: string): Promise<boolean> {
        // Placeholder implementation
        return true;
    }

    /**
     * Get all active subscription types for a user
     * @param userId The user ID to check
     * @returns Array of active subscription types
     */
    async getActiveSubscriptionTypes(userId: string): Promise<SubscriptionType[]> {
        // Placeholder implementation
        return [SubscriptionType.CIBLE, SubscriptionType.CLASSIQUE];
    }

    /**
     * Updates a subscription by its ID.
     * @param subscriptionId - The ID of the subscription to update.
     * @param updateData - The fields to update.
     * @returns The updated subscription document or null.
     */
    async updateById(subscriptionId: string | Types.ObjectId, updateData: Partial<ISubscription>): Promise<any | null> {
        try {
            // Use { new: true } to return the modified document
            return await SubscriptionModel.findByIdAndUpdate(subscriptionId, { $set: updateData }, { new: true }).exec();
        } catch (error: any) {
            log.error(`Error updating subscription ${subscriptionId}: ${error.message}`);
            throw error; // Re-throw the error for the service layer to handle
        }
    }

    /**
     * Updates the status of a subscription.
     * @param subscriptionId - The ID of the subscription to update.
     * @param status - The new status.
     * @returns The updated subscription document or null.
     */
    async updateStatus(subscriptionId: string | Types.ObjectId, status: SubscriptionStatus): Promise<any | null> {
        return this.updateById(subscriptionId, { status }); // Use the generic updateById
    }

    /**
     * Finds all unique user IDs that have at least one active subscription.
     * @returns An array of unique user IDs (as strings).
     */
    async findAllUserIdsWithActiveSubscriptions(): Promise<Types.ObjectId[]> {
        try {
            const result = await SubscriptionModel.aggregate([
                { $match: { status: SubscriptionStatus.ACTIVE, endDate: { $gt: new Date() } } },
                { $group: { _id: '$user' } },
                { $project: { _id: 1 } }
            ]);
            return result.map(item => item._id);
        } catch (error) {
            log.error('Error finding user IDs with active subscriptions:', error);
            throw error;
        }
    }

    /**
     * Finds subscriptions that have expired (endDate is past, status is still ACTIVE).
     * Useful for a background job to update statuses.
     * @param limit - Maximum number of expired subscriptions to return.
     * @returns An array of expired subscription documents.
     */
    async findCurrentlyExpiredActiveSubscriptions(limit = 100): Promise<any[]> { // Renamed to avoid conflict
        const now = new Date();
        return SubscriptionModel.find({
            status: SubscriptionStatus.ACTIVE,
            endDate: { $lte: now }, // End date is less than or equal to now
        })
            .limit(limit)
            .exec();
    }

    /**
     * Updates the status of multiple subscriptions by their IDs.
     * @param subscriptionIds - An array of subscription IDs.
     * @param status - The new status to set.
     * @returns MongoDB update result.
     */
    async updateStatusMany(subscriptionIds: (string | Types.ObjectId)[], status: SubscriptionStatus): Promise<UpdateWriteOpResult> {
        return SubscriptionModel.updateMany(
            { _id: { $in: subscriptionIds } },
            { $set: { status } }
        ).exec();
    }

    /**
     * Create a new subscription
     * @param subscriptionData Data for the new subscription
     * @returns Created subscription
     */
    async createSubscription(subscriptionData: Partial<ISubscription>): Promise<any> {
        try {
            // Ensure status is set correctly if not provided
            const dataToSave = {
                status: SubscriptionStatus.ACTIVE,
                ...subscriptionData,
                startDate: subscriptionData.startDate || new Date(), // Default start date
            };
            const subscription = new SubscriptionModel(dataToSave);
            return await subscription.save();
        } catch (error: any) {
            log.error(`Error creating subscription: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find active subscriptions for a user
     * @param userId User ID
     * @param page Page number for pagination (default: 1)
     * @param limit Number of items per page (default: 10)
     * @returns Paginated active subscriptions
     */
    async findActiveSubscriptions(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10
    ): Promise<SubscriptionPaginationResponse> {
        try {
            const skip = (page - 1) * limit;
            const now = new Date();
            const query = {
                user: userId,
                status: SubscriptionStatus.ACTIVE,
                endDate: { $gt: now }
            };

            const subscriptions = await SubscriptionModel.find(query)
                .sort({ endDate: 1 })
                .skip(skip)
                .limit(limit);

            const totalCount = await SubscriptionModel.countDocuments(query);

            return {
                subscriptions,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error: any) {
            log.error(`Error finding active subscriptions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find expired subscriptions for a user
     * @param userId User ID
     * @param page Page number for pagination (default: 1)
     * @param limit Number of items per page (default: 10)
     * @returns Paginated expired subscriptions
     */
    async findExpiredSubscriptions(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10
    ): Promise<SubscriptionPaginationResponse> {
        try {
            const skip = (page - 1) * limit;
            const now = new Date();
            const query = {
                user: userId,
                $or: [
                    { status: SubscriptionStatus.EXPIRED },
                    { status: SubscriptionStatus.ACTIVE, endDate: { $lte: now } }
                ]
            };

            const subscriptions = await SubscriptionModel.find(query)
                .sort({ endDate: -1 })
                .skip(skip)
                .limit(limit);

            const totalCount = await SubscriptionModel.countDocuments(query);

            return {
                subscriptions,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error: any) {
            log.error(`Error finding expired subscriptions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find all subscriptions for a user
     * @param userId User ID
     * @param page Page number for pagination (default: 1)
     * @param limit Number of items per page (default: 10)
     * @param category Optional category filter (registration or feature)
     * @returns Paginated user subscriptions
     */
    async findUserSubscriptions(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10,
        category?: SubscriptionCategory
    ): Promise<SubscriptionPaginationResponse> {
        try {
            const skip = (page - 1) * limit;
            const query: mongoose.FilterQuery<ISubscription> = { user: userId };

            // Add category filter if provided
            if (category) {
                query.category = category;
            }

            const subscriptions = await SubscriptionModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            const totalCount = await SubscriptionModel.countDocuments(query);

            return {
                subscriptions,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error: any) {
            log.error(`Error finding user subscriptions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find active subscription of a specific type for a user
     * @param userId User ID
     * @param type Subscription type
     * @returns Active subscription of the specified type or null
     */
    async findActiveSubscriptionByType(
        userId: string | Types.ObjectId,
        type: SubscriptionType
    ): Promise<any | null> {
        const now = new Date();
        return SubscriptionModel.findOne({
            user: userId,
            subscriptionType: type,
            status: SubscriptionStatus.ACTIVE,
            endDate: { $gt: now }
        })
            .sort({ endDate: -1 }) // Get the one expiring latest if multiple somehow exist
            .exec();
    }

    /**
     * Extend subscription end date
     * @param subscriptionId Subscription ID
     * @param daysToAdd Number of days to add
     * @returns Updated subscription
     */
    async extendSubscription(
        subscriptionId: string | Types.ObjectId,
        daysToAdd: number
    ): Promise<any | null> {
        try {
            const subscription = await this.findById(subscriptionId);
            if (!subscription) return null;

            // Calculate new end date
            const currentEndDate = subscription.endDate || new Date(); // Handle case where endDate might be null/undefined initially
            const newEndDate = new Date(currentEndDate);
            newEndDate.setDate(newEndDate.getDate() + daysToAdd);

            // Update subscription using updateById
            return this.updateById(subscriptionId, {
                endDate: newEndDate,
                status: SubscriptionStatus.ACTIVE // Ensure it's active when extending
            });
        } catch (error: any) {
            log.error(`Error extending subscription: ${error.message}`);
            throw error;
        }
    }

    /**
     * Cancel subscription
     * @param subscriptionId Subscription ID
     * @returns Updated subscription
     */
    async cancelSubscription(
        subscriptionId: string | Types.ObjectId
    ): Promise<any | null> {
        // Use updateById for consistency
        return this.updateById(subscriptionId, { status: SubscriptionStatus.CANCELLED });
    }

    /**
     * Find expiring subscriptions within days
     * @param days Number of days to look ahead
     * @param page Page number for pagination (default: 1)
     * @param limit Number of items per page (default: 50)
     * @returns Paginated soon-to-expire subscriptions
     */
    async findExpiringSubscriptions(
        days: number,
        page: number = 1,
        limit: number = 50
    ): Promise<SubscriptionPaginationResponse> {
        try {
            const skip = (page - 1) * limit;
            const now = new Date();
            const futureDate = new Date(now);
            futureDate.setDate(futureDate.getDate() + days);

            const query = {
                status: SubscriptionStatus.ACTIVE,
                endDate: {
                    $gt: now,
                    $lte: futureDate
                }
            };

            const subscriptions = await SubscriptionModel.find(query)
                .sort({ endDate: 1 })
                .skip(skip)
                .limit(limit);

            const totalCount = await SubscriptionModel.countDocuments(query);

            return {
                subscriptions,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error: any) {
            log.error(`Error finding expiring subscriptions: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generic find method with pagination and sorting.
     * @param query - Mongoose query object.
     * @param limit - Max items per page.
     * @param skip - Number of items to skip.
     * @param sort - Sort criteria.
     * @returns Array of subscription documents.
     */
    async find(query: mongoose.FilterQuery<ISubscription>, limit: number, skip: number, sort: any): Promise<any[]> {
        return SubscriptionModel.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean() // Use lean for potentially better performance if full Mongoose docs aren't needed
            .exec();
    }

    /**
     * Generic count method.
     * @param query - Mongoose query object.
     * @returns The count of matching documents.
     */
    async count(query: mongoose.FilterQuery<ISubscription>): Promise<number> {
        return SubscriptionModel.countDocuments(query).exec();
    }

    /**
     * Aggregates the count of active subscriptions per month within a given date range.
     * @param type - The type of subscription (CLASSIQUE or CIBLE)
     * @param startDate - The beginning of the date range.
     * @param endDate - The end of the date range.
     * @returns Array of objects { month: 'YYYY-M', count: number }
     */
    async getMonthlyActiveSubscriptionCounts(
        type: SubscriptionType,
        startDate: Date,
        endDate: Date
    ): Promise<{ month: string; count: number }[]> {
        log.info(`Aggregating monthly active counts for type ${type} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        try {
            const results = await SubscriptionModel.aggregate([
                // 1. Match relevant subscriptions (correct type, potentially active/expired but overlapping the date range)
                {
                    $match: {
                        type: type,
                        // Subscription must start before the overall endDate
                        // AND end after the overall startDate to be potentially active within the range
                        startDate: { $lt: endDate }, // Started before the period ends
                        endDate: { $gt: startDate } // Ended after the period starts
                        // We don't filter by status here, as an expired sub could have been active during the range
                    }
                },
                // 2. Generate a sequence of months for each subscription's active period within the desired range
                {
                    $addFields: {
                        // Clamp subscription start/end to the global range for month generation
                        effectiveStartDate: { $max: ["$startDate", startDate] },
                        effectiveEndDate: { $min: ["$endDate", endDate] }
                    }
                },
                {
                    $addFields: {
                        // Generate array of month start dates within the effective range
                        monthsActive: {
                            $map: {
                                input: {
                                    // Create sequence from 0 up to the number of months difference
                                    $range: [
                                        0,
                                        {
                                            $add: [
                                                {
                                                    $dateDiff: {
                                                        startDate: "$effectiveStartDate",
                                                        endDate: "$effectiveEndDate",
                                                        unit: "month"
                                                    }
                                                },
                                                1 // Add 1 because dateDiff might round down or be zero for same month
                                            ]
                                        }
                                    ]
                                },
                                as: "m",
                                in: {
                                    $dateTrunc: { // Get the start of the month
                                        date: {
                                            $dateAdd: {
                                                startDate: "$effectiveStartDate",
                                                unit: "month",
                                                amount: "$$m"
                                            }
                                        },
                                        unit: "month"
                                    }
                                }
                            }
                        }
                    }
                },
                // Filter out months generated outside the effective range (due to dateAdd/dateDiff nuances)
                {
                    $addFields: {
                        monthsActiveFiltered: {
                            $filter: {
                                input: "$monthsActive",
                                as: "monthDate",
                                // Ensure the generated month start is within the clamped effective range
                                cond: { $and: [{ $gte: ["$$monthDate", "$effectiveStartDate"] }, { $lt: ["$$monthDate", "$effectiveEndDate"] }] }
                            }
                        }
                    }
                },
                // 3. Unwind the array of months
                { $unwind: "$monthsActiveFiltered" },

                // 4. Group by month and count
                {
                    $group: {
                        _id: {
                            year: { $year: "$monthsActiveFiltered" },
                            month: { $month: "$monthsActiveFiltered" }
                        },
                        count: { $sum: 1 }
                    }
                },
                // 5. Format the output
                { $sort: { "_id.year": 1, "_id.month": 1 } },
                {
                    $project: {
                        _id: 0,
                        month: { $concat: [{ $toString: "$_id.year" }, "-", { $toString: "$_id.month" }] },
                        count: 1
                    }
                }
            ]);
            log.debug(`Monthly counts for ${type}:`, results);
            return results;
        } catch (error) {
            log.error(`Error aggregating monthly active subscription counts for type ${type}:`, error);
            throw error;
        }
    }

    /**
     * Counts the number of currently active subscriptions for a specific type.
     * Active means status is ACTIVE and endDate is in the future.
     * @param type - The type of subscription to count.
     * @returns The number of active subscriptions of the specified type.
     */
    async countActiveSubscriptionsByType(type: SubscriptionType): Promise<number> {
        log.info(`Counting active subscriptions for type: ${type}`);
        const now = new Date();
        const query: mongoose.FilterQuery<ISubscription> = {
            subscriptionType: type,
            status: SubscriptionStatus.ACTIVE,
            endDate: { $gt: now },
        };
        try {
            const count = await SubscriptionModel.countDocuments(query).exec();
            log.debug(`Found ${count} active subscriptions for type: ${type}`);
            return count;
        } catch (error) {
            log.error(`Error counting active subscriptions for type ${type}:`, error);
            throw error; // Re-throw for the service layer
        }
    }

    /**
     * Finds all active subscriptions for a list of user IDs.
     * Only returns CLASSIQUE and CIBLE subscriptions (excludes RELANCE).
     * @param userIds - An array of user ObjectIds.
     * @returns An array of active subscription documents.
     */
    async findActiveSubscriptionsForMultipleUsers(userIds: Types.ObjectId[]): Promise<any[]> { // Using any for now
        if (!userIds || userIds.length === 0) {
            return [];
        }
        const now = new Date();
        const query: mongoose.FilterQuery<ISubscription> = {
            user: { $in: userIds },
            status: SubscriptionStatus.ACTIVE,
            subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
            endDate: { $gt: now },
        };
        // Select only necessary fields: user and subscriptionType
        return SubscriptionModel.find(query).select('user subscriptionType').lean().exec();
    }
}

// Export an instance
export const subscriptionRepository = new SubscriptionRepository(); 