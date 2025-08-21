import { Types, FilterQuery, SortOrder, UpdateQuery } from 'mongoose';
import { nanoid } from 'nanoid';
import TransactionModel, { ITransaction, TransactionStatus, TransactionType, Currency } from '../models/transaction.model';
import logger from '../../utils/logger';
import { BaseRepository } from './base.repository';
import { PaginationOptions } from '../../types/pagination';

const log = logger.getLogger('TransactionRepository');

// Enum for different subscription types
export enum SubscriptionType {
    ALL_CONTACTS = 'ALL_CONTACTS',
    TARGETED_CONTACTS = 'TARGETED_CONTACTS',
    CONTACT_PLAN = 'CONTACT_PLAN',
    SALES_BOOST = 'SALES_BOOST',
    // Add other subscription types here
}

// Interface for creating a new transaction
export interface CreateTransactionInput {
    userId: string | Types.ObjectId;
    type: TransactionType;
    amount: number;
    currency: Currency;
    fee?: number;
    status?: TransactionStatus;
    description: string;
    metadata?: Record<string, any>;
    paymentProvider?: {
        provider: string;
        transactionId: string;
        status: string;
        metadata?: Record<string, any>;
    };
    relatedTransactions?: (string | Types.ObjectId)[];
    ipAddress?: string;
    deviceInfo?: string;
    verificationCode?: string;
    verificationExpiry?: Date;
}

// Interface for updating a transaction
export interface UpdateTransactionInput {
    status?: TransactionStatus;
    description?: string;
    metadata?: Record<string, any>;
    paymentProvider?: {
        provider: string;
        transactionId: string;
        status: string;
        metadata?: Record<string, any>;
    };
    relatedTransactions?: (string | Types.ObjectId)[];
    verificationCode?: string;
    verificationExpiry?: Date;
    reference?: string;
    serviceProvider?: string;
    paymentMethod?: string;
    externalTransactionId?: string;
    // Add index signature to allow any string key
    [key: string]: any;
}

export class TransactionRepository extends BaseRepository<ITransaction> {
    constructor() {
        super(TransactionModel);
    }

    /**
     * Create a new transaction
     */
    async create(input: CreateTransactionInput): Promise<ITransaction> {
        try {
            const transactionId = nanoid(16);
            // Ensure userId is ObjectId before assigning to Partial<ITransaction>
            const userIdAsObjectId = typeof input.userId === 'string' ? new Types.ObjectId(input.userId) : input.userId;

            const transactionData: Partial<ITransaction> = {
                transactionId,
                userId: userIdAsObjectId, // Use the converted ObjectId
                type: input.type,
                amount: input.amount,
                currency: input.currency,
                fee: input.fee || 0,
                status: input.status || TransactionStatus.PENDING, // Always start as pending
                description: input.description,
                metadata: input.metadata,
                paymentProvider: input.paymentProvider,
                relatedTransactions: input.relatedTransactions as Types.ObjectId[] | undefined, // Ensure type match
                ipAddress: input.ipAddress,
                deviceInfo: input.deviceInfo,
            };

            const transaction = await this.model.create(transactionData); // Use this.model

            log.info(`Created transaction ${transactionId} for user ${input.userId}`);
            return transaction;
        } catch (error) {
            log.error(`Error creating transaction: ${error}`);
            throw error;
        }
    }

    /**
     * Find a transaction by its ID
     */
    async findById(id: string | Types.ObjectId): Promise<ITransaction | null> {
        try {
            return await this.model.findById(id);
        } catch (error) {
            log.error(`Error finding transaction by ID ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Find a transaction by its transaction ID
     */
    async findByTransactionId(transactionId: string, options?: { select?: string }): Promise<ITransaction | null> {
        try {
            const query = this.model.findOne({ transactionId });
            if (options?.select) {
                query.select(options.select);
            }
            return await query.lean<ITransaction>().exec();
        } catch (error) {
            log.error(`Error finding transaction by transactionId ${transactionId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find a transaction by its external transaction ID
     */
    async findByExternalTransactionId(externalTransactionId: string): Promise<ITransaction | null> {
        try {
            return await this.model.findOne({ externalTransactionId }).lean<ITransaction>().exec();
        } catch (error) {
            log.error(`Error finding transaction by externalTransactionId ${externalTransactionId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find transactions for a specific user
     */
    async findByUserId(
        userId: string | Types.ObjectId,
        options: {
            type?: TransactionType;
            status?: TransactionStatus;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
            page?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<{ transactions: ITransaction[]; total: number }> {
        try {
            const {
                type,
                status,
                startDate,
                endDate,
                limit = 50,
                page = 0,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = options;

            // Build query
            const query: FilterQuery<ITransaction> = { userId };
            if (type) query.type = type;
            if (status) query.status = status;

            // Date range
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = startDate;
                if (endDate) query.createdAt.$lte = endDate;
            }

            const skip = (page - 1) * limit;

            // Find transactions
            const transactions = await this.model.find(query)
                .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(limit)
                .lean<ITransaction[]>() // Use lean
                .exec();

            // Count total for pagination
            const total = await this.model.countDocuments(query).exec();

            return { transactions, total };
        } catch (error) {
            log.error(`Error finding transactions for user ${userId}: ${error}`);
            throw error;
        }
    }

    /**
     * Update a transaction by its ID
     */
    async update(id: string | Types.ObjectId, update: UpdateTransactionInput): Promise<ITransaction | null> {
        return super.updateById(id, update as UpdateQuery<ITransaction>);
    }

    /**
     * Update a transaction's status by its transaction ID
     */
    async updateStatus(transactionId: string, status: TransactionStatus, additionalUpdate?: UpdateQuery<ITransaction>): Promise<ITransaction | null> {
        try {
            const updateFields: UpdateQuery<ITransaction> = { status };
            if (additionalUpdate) {
                Object.assign(updateFields, additionalUpdate); // Merge additional update fields
            }

            const transaction = await this.model.findOneAndUpdate(
                { transactionId },
                { $set: updateFields }, // Use $set to apply updates
                { new: true }
            ).lean<ITransaction>().exec();

            if (transaction) {
                log.info(`Updated transaction ${transactionId} status to ${status}`);
            }

            return transaction;
        } catch (error) {
            log.error(`Error updating transaction ${transactionId} status: ${error}`);
            throw error;
        }
    }

    /**
     * Soft delete a transaction
     */
    async softDelete(id: string | Types.ObjectId): Promise<ITransaction | null> {
        try {
            const transaction = await this.model.findByIdAndUpdate( // Use this.model
                id,
                { $set: { deleted: true, deletedAt: new Date() } },
                { new: true }
            ).lean<ITransaction>().exec(); // Use lean

            if (transaction) {
                log.info(`Soft deleted transaction ${transaction.transactionId}`);
            }

            return transaction;
        } catch (error) {
            log.error(`Error soft deleting transaction ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Get transaction statistics for a user
     */
    async getTransactionStats(userId: string | Types.ObjectId): Promise<any> {
        try {
            const now = new Date();
            // Start of today, used for calculating daily ranges
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // Calculate start dates for MongoDB $match filters
            // 7 days including today
            const startOf7DaysAgo = new Date(startOfToday);
            startOf7DaysAgo.setDate(startOfToday.getDate() - 6);

            // 5 weeks including current week
            const startOf5WeeksAgo = new Date(now);
            startOf5WeeksAgo.setDate(now.getDate() - (5 * 7));

            // 12 months including current month, starting from the 1st
            const startOf12MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

            const userObjectId = new Types.ObjectId(userId.toString());

            // Helper to get ISO week, year, and calendar month from a date
            const getISOWeekDetails = (date: Date) => {
                const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Adjust to Thursday in current week for ISO week calculation
                const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                return {
                    year: d.getUTCFullYear(),
                    month: date.getMonth() + 1, // Calendar month (0-11) + 1
                    week: weekNo
                };
            };

            // 1. Generate a full list of all expected period keys (client-side)

            // For the last 7 days (YYYY-MM-DD)
            const allDailyKeys: string[] = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(startOfToday);
                d.setDate(startOfToday.getDate() - i);
                allDailyKeys.unshift(d.toISOString().split('T')[0]); // Add to beginning to keep chronological order
            }

            // For the last 5 weeks (Week 1 to Week 5)
            const distinctActualWeeklyKeysSorted: { year: number; month: number; week: number; formattedKey: string }[] = [];
            // Iterate from startOf5WeeksAgo up to now, day by day, to capture all unique week/month combinations
            for (let d = new Date(startOf5WeeksAgo); d <= now; d.setDate(d.getDate() + 1)) {
                const { year, month, week } = getISOWeekDetails(d);
                const formattedKey = `${year}-${month.toString().padStart(2, '0')}-${week.toString().padStart(2, '0')}`;
                if (!distinctActualWeeklyKeysSorted.some(item => item.formattedKey === formattedKey)) {
                    distinctActualWeeklyKeysSorted.push({ year, month, week, formattedKey });
                }
            }
            // Ensure sorted chronologically
            distinctActualWeeklyKeysSorted.sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                if (a.week !== b.week) return a.week - b.week;
                return a.month - b.month; // Secondary sort for robustness in edge cases
            });

            const actualWeekToLabelMap = new Map<string, string>();
            // Assign labels: Week 1, Week 2, ..., Week 5, mapping actual week keys to these labels
            distinctActualWeeklyKeysSorted.forEach((keyDetails, index) => {
                if (index < 5) { // Only map up to 5 weeks to the "Week X" labels
                    const label = `Week ${index + 1}`;
                    actualWeekToLabelMap.set(keyDetails.formattedKey, label);
                }
            });

            // The `allWeeklyKeys` should now be the fixed labels
            const allWeeklyKeys: string[] = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];


            // For the last 12 months (YYYY-MM)
            const allMonthlyKeys: string[] = [];
            for (let i = 0; i < 12; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                allMonthlyKeys.unshift(`${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`);
            }

            // 2. Perform aggregation using $facet to get overall, daily, weekly, and monthly stats
            const stats = await this.model.aggregate([
                { $match: { userId: userObjectId, deleted: { $ne: true } } },
                {
                    $facet: {
                        overall: [
                            {
                                $group: {
                                    _id: { type: '$type', status: '$status' },
                                    count: { $sum: 1 },
                                    totalAmount: { $sum: '$amount' },
                                    totalFees: { $sum: '$fee' }
                                }
                            },
                            { $sort: { '_id.type': 1, '_id.status': 1 } }
                        ],
                        dailyStats: [
                            { $match: { createdAt: { $gte: startOf7DaysAgo } } },
                            {
                                $group: {
                                    _id: {
                                        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                                        type: '$type'
                                    },
                                    count: { $sum: 1 },
                                    totalAmount: { $sum: '$amount' }
                                }
                            },
                            { $sort: { '_id.day': 1, '_id.type': 1 } }
                        ],
                        weeklyStats: [
                            { $match: { createdAt: { $gte: startOf5WeeksAgo } } }, // Changed to 5 weeks
                            {
                                $group: {
                                    _id: {
                                        year: { $isoWeekYear: '$createdAt' },
                                        month: { $month: '$createdAt' }, // Added month to group ID
                                        week: { $isoWeek: '$createdAt' },
                                        type: '$type'
                                    },
                                    count: { $sum: 1 },
                                    totalAmount: { $sum: '$amount' }
                                }
                            },
                            { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1, '_id.type': 1 } } // Added month to sort
                        ],
                        monthlyStats: [
                            { $match: { createdAt: { $gte: startOf12MonthsAgo } } },
                            {
                                $group: {
                                    _id: {
                                        year: { $year: '$createdAt' },
                                        month: { $month: '$createdAt' },
                                        type: '$type'
                                    },
                                    count: { $sum: 1 },
                                    totalAmount: { $sum: '$amount' }
                                }
                            },
                            { $sort: { '_id.year': 1, '_id.month': 1, '_id.type': 1 } }
                        ]
                    }
                }
            ]).exec();

            // 3. Format overall stats, ensuring withdrawal amounts are positive
            const formattedOverall = stats[0].overall.reduce((result: any, item: any) => {
                const type = item._id.type;
                const status = item._id.status;
                if (!result[type]) result[type] = {};
                result[type][status] = {
                    count: item.count,
                    totalAmount: type === TransactionType.WITHDRAWAL ? Math.abs(item.totalAmount) : item.totalAmount,
                    totalFees: item.totalFees
                };
                return result;
            }, {});

            // 4. Helper to format period-based stats, filling missing periods with zeros
            function formatPeriodStats(arr: any[], allPeriods: string[], periodType: 'daily' | 'weekly' | 'monthly', weekMap?: Map<string, string>) {
                const out: any = {};

                // Initialize all periods with 0 values for both deposit and withdrawal
                allPeriods.forEach(periodKey => {
                    out[periodKey] = {
                        [TransactionType.DEPOSIT]: { count: 0, totalAmount: 0 },
                        [TransactionType.WITHDRAWAL]: { count: 0, totalAmount: 0 }
                    };
                });

                // Populate with actual data from aggregation results
                arr.forEach(item => {
                    let periodKey: string;
                    const id = item._id; // Destructure _id for easier access

                    if (periodType === 'daily') {
                        periodKey = id.day;
                    } else if (periodType === 'weekly') {
                        // Construct the full aggregated week key to look up in the map
                        const currentAggregatedWeekKey = `${id.year}-${id.month.toString().padStart(2, '0')}-${id.week.toString().padStart(2, '0')}`;
                        periodKey = weekMap?.get(currentAggregatedWeekKey) || ''; // Get "Week X" label from the map

                        if (!periodKey) {
                            log.warn(`Could not map aggregated week key ${currentAggregatedWeekKey} to a 'Week X' label. This week might be outside the last 5 weeks range.`);
                            return; // Skip this item if it cannot be mapped
                        }
                    } else if (periodType === 'monthly') {
                        periodKey = `${id.year}-${id.month.toString().padStart(2, '0')}`;
                    } else {
                        log.warn(`Unknown periodType in formatPeriodStats: ${periodType}`);
                        return;
                    }

                    // If the period key exists (it should, as we initialized it), update it
                    if (out[periodKey]) {
                        if (item._id.type === TransactionType.DEPOSIT) {
                            out[periodKey][TransactionType.DEPOSIT].count = item.count;
                            out[periodKey][TransactionType.DEPOSIT].totalAmount = item.totalAmount;
                        } else if (item._id.type === TransactionType.WITHDRAWAL) {
                            out[periodKey][TransactionType.WITHDRAWAL].count = item.count;
                            out[periodKey][TransactionType.WITHDRAWAL].totalAmount = Math.abs(item.totalAmount); // Make payouts positive
                        }
                    } else {
                        // This case should ideally not happen if allPeriods is comprehensive and mapping is correct
                        log.warn(`Aggregated data for period ${periodKey} found outside generated 'allPeriods' range. This might indicate a logic error.`);
                    }
                });
                return out;
            }

            // Apply formatting for each period type
            const dailyStats = formatPeriodStats(stats[0].dailyStats, allDailyKeys, 'daily');
            // Pass the generated map for weekly stats
            const weeklyStats = formatPeriodStats(stats[0].weeklyStats, allWeeklyKeys, 'weekly', actualWeekToLabelMap);
            const monthlyStats = formatPeriodStats(stats[0].monthlyStats, allMonthlyKeys, 'monthly');

            // Return the combined stats object
            return {
                overall: formattedOverall,
                daily: dailyStats,
                weekly: weeklyStats,
                monthly: monthlyStats
            };
        } catch (error) {
            log.error(`Error getting transaction stats for user ${userId}: ${error}`);
            throw error;
        }
    }

    async countAllTransactions(): Promise<number> {
        const count = await this.model.countDocuments({ deleted: { $ne: true } }).exec();
        return count;
    }

    /**
     * Finds transactions matching the given filters with pagination.
     */
    async findAllWithFilters(
        filters: FilterQuery<ITransaction>,
        options: PaginationOptions
    ): Promise<{ transactions: ITransaction[]; totalCount: number }> {
        const query = this.buildFilterQuery(filters);

        // Use this.model here
        const totalCount = await this.model.countDocuments(query).exec();

        const skip = (options.page - 1) * options.limit;
        const sortOptions: { [key: string]: SortOrder } = {}; // Use SortOrder
        if (options.sortBy && options.sortOrder) { // Check if defined
            sortOptions[options.sortBy] = options.sortOrder === 'asc' ? 1 : -1;
        }

        const transactions = await this.model // Use this.model here
            .find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(options.limit)
            .lean<ITransaction[]>() // Use lean for performance
            .exec();

        return { transactions, totalCount };
    }

    /**
     * Helper to build the Mongoose filter query object.
     */
    private buildFilterQuery(filters: Record<string, any>): FilterQuery<ITransaction> {
        // Keep existing implementation
        const query: FilterQuery<ITransaction> = {};

        for (const key in filters) {
            if (filters.hasOwnProperty(key) && filters[key] !== undefined) {
                if (key === 'userId' && filters[key].$in && Array.isArray(filters[key].$in)) {
                    query.userId = { $in: filters[key].$in.map((id: string) => new Types.ObjectId(id)) };
                } else if (key === 'createdAt' || key === 'amount') {
                    query[key as keyof ITransaction] = filters[key];
                } else {
                    query[key as keyof ITransaction] = filters[key];
                }
            }
        }
        // Add default filter to exclude deleted
        if (!filters.hasOwnProperty('deleted')) {
            query.deleted = { $ne: true };
        }
        return query;
    }

    /**
     * Calculates the sum of completed withdrawal amounts for a specific user.
     * @param userId - The ID of the user.
     * @returns The total withdrawal amount (always positive). Returns 0 if no withdrawals found.
     */
    async calculateTotalWithdrawalsForUser(userId: string | Types.ObjectId): Promise<number> {
        log.info(`Calculating total completed withdrawal amount for user ${userId}`);
        try {
            const result = await this.model.aggregate([
                {
                    $match: {
                        userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
                        type: TransactionType.WITHDRAWAL,
                        status: TransactionStatus.COMPLETED,
                        deleted: { $ne: true } // Exclude soft-deleted
                    }
                },
                {
                    $group: {
                        _id: null, // Group all matched documents for the user
                        // Withdrawal amounts are stored negative, so sum and negate
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]).exec();

            // Result is an array, check if it's empty (no completed withdrawals for this user)
            const total = result.length > 0 ? result[0].totalAmount : 0;
            // Negate the result because withdrawal amounts are stored negatively
            return Math.abs(total);
        } catch (error) {
            log.error(`Error calculating total withdrawal amount for user ${userId}:`, error);
            throw new Error('Failed to calculate user total withdrawal amount'); // Throw a more specific error
        }
    }

    /**
     * Finds a single transaction matching the given filters.
     * NEW METHOD: Required for soft lock.
     */
    async findOneByFilters(filters: FilterQuery<ITransaction>): Promise<ITransaction | null> {
        try {
            const query = this.buildFilterQuery(filters); // Reuse existing filter builder
            // Important: Use .exec() to get a real Promise, and .lean() for performance
            return await this.model.findOne(query).lean<ITransaction>().exec();
        } catch (error) {
            log.error(`Error finding single transaction by filters: ${error}`);
            throw error;
        }
    }

    /**
     * Find all processing withdrawal transactions for status checking
     */
    async findProcessingWithdrawals(limit: number = 100): Promise<ITransaction[]> {
        try {
            const query = {
                type: TransactionType.WITHDRAWAL,
                status: TransactionStatus.PROCESSING,
                deleted: { $ne: true }
            };

            return await this.model
                .find(query)
                .sort({ createdAt: 1 }) // Oldest first
                .limit(limit)
                .lean<ITransaction[]>()
                .exec();
        } catch (error) {
            log.error(`Error finding processing withdrawal transactions: ${error}`);
            throw error;
        }
    }
}

// Export singleton instance
export const transactionRepository = new TransactionRepository();
export default transactionRepository; 