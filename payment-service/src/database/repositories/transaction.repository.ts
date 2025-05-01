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
                status: TransactionStatus.PENDING, // Always start as pending
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
    async findByTransactionId(transactionId: string): Promise<ITransaction | null> {
        try {
            return await this.model.findOne({ transactionId }).lean<ITransaction>().exec(); // Use this.model and lean
        } catch (error) {
            log.error(`Error finding transaction by transactionId ${transactionId}: ${error}`);
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
            skip?: number;
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
                skip = 0,
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
    async updateStatus(transactionId: string, status: TransactionStatus): Promise<ITransaction | null> {
        try {
            const transaction = await this.model.findOneAndUpdate( // Use this.model
                { transactionId },
                { $set: { status } },
                { new: true }
            ).lean<ITransaction>().exec(); // Use lean

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
            const stats = await this.model.aggregate([ // Use this.model
                { $match: { userId: new Types.ObjectId(userId.toString()), deleted: { $ne: true } } },
                {
                    $group: {
                        _id: { type: '$type', status: '$status' },
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        totalFees: { $sum: '$fee' }
                    }
                },
                { $sort: { '_id.type': 1, '_id.status': 1 } }
            ]);

            // Transform results to be more user-friendly
            const formattedStats = stats.reduce((result: any, item) => {
                const type = item._id.type;
                const status = item._id.status;

                if (!result[type]) {
                    result[type] = {};
                }

                result[type][status] = {
                    count: item.count,
                    totalAmount: item.totalAmount,
                    totalFees: item.totalFees
                };

                return result;
            }, {});

            return formattedStats;
        } catch (error) {
            log.error(`Error getting transaction stats for user ${userId}: ${error}`);
            throw error;
        }
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
}

// Export singleton instance
export const transactionRepository = new TransactionRepository();
export default transactionRepository; 