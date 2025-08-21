import { Types } from 'mongoose';
import DailyWithdrawalModel, { IDailyWithdrawal } from '../models/daily-withdrawal.model';
import logger from '../../utils/logger';

// Define pagination response interface
export interface DailyWithdrawalPaginationResponse {
    withdrawals: any[]; // Use any to bypass type issues
    totalCount: number;
    totalPages: number;
    page: number;
}

export class DailyWithdrawalRepository {
    /**
     * Creates a new daily withdrawal record
     * @param data - Daily withdrawal data
     * @returns The created withdrawal record
     */
    async createDailyWithdrawal(data: any): Promise<any> {
        try {
            const dailyWithdrawal = new DailyWithdrawalModel(data);
            return await dailyWithdrawal.save();
        } catch (error) {
            logger.error('Error in createDailyWithdrawal:', error);
            throw error;
        }
    }

    /**
     * Gets a specific daily withdrawal record by ID
     * @param id - Withdrawal record ID
     * @returns The withdrawal record if found, null otherwise
     */
    async getDailyWithdrawal(id: string | Types.ObjectId): Promise<any | null> {
        try {
            return await DailyWithdrawalModel.findById(id).exec();
        } catch (error) {
            logger.error('Error in getDailyWithdrawal:', error);
            throw error;
        }
    }

    /**
     * Gets a daily withdrawal record for a user on a specific date
     * @param userId - User ID
     * @param date - Date to find record for
     * @returns The withdrawal record if found, null otherwise
     */
    async getDailyWithdrawalByUserAndDate(userId: string | Types.ObjectId, date: Date): Promise<any | null> {
        try {
            // Create start and end of the specified day
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            return await DailyWithdrawalModel.findOne({
                userId: new Types.ObjectId(userId.toString()),
                date: { $gte: startOfDay, $lte: endOfDay }
            }).exec();
        } catch (error) {
            logger.error('Error in getDailyWithdrawalByUserAndDate:', error);
            throw error;
        }
    }

    /**
     * Updates a daily withdrawal record
     * @param id - Withdrawal record ID
     * @param data - Update data
     * @returns The updated withdrawal record
     */
    async updateDailyWithdrawal(id: string | Types.ObjectId, data: Partial<IDailyWithdrawal>): Promise<any | null> {
        try {
            return await DailyWithdrawalModel.findByIdAndUpdate(
                id,
                { $set: data },
                { new: true }
            ).exec();
        } catch (error) {
            logger.error('Error in updateDailyWithdrawal:', error);
            throw error;
        }
    }

    /**
     * Increments successful withdrawal count for a user on a specific date
     * @param userId - User ID
     * @param date - Date of withdrawal
     * @param amount - Amount withdrawn (to add to totalAmount)
     * @returns The updated withdrawal record
     */
    async incrementSuccessfulWithdrawal(userId: string | Types.ObjectId, date: Date, amount: number): Promise<IDailyWithdrawal | null> {
        try {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);

            return await DailyWithdrawalModel.findOneAndUpdate(
                { 
                    userId: new Types.ObjectId(userId.toString()), 
                    date: startOfDay 
                },
                { 
                    $inc: { 
                        successfulCount: 1,
                        totalAmount: amount,
                        count: 1
                    }
                },
                { 
                    new: true, 
                    upsert: true,
                    setDefaultsOnInsert: true
                }
            ).exec();
        } catch (error) {
            logger.error('Error in incrementSuccessfulWithdrawal:', error);
            throw error;
        }
    }

    /**
     * Gets all daily withdrawal records with pagination
     * @param page - Page number (default: 1)
     * @param limit - Items per page (default: 10)
     * @returns Paginated list of withdrawal records
     */
    async getAllDailyWithdrawals(
        page: number = 1,
        limit: number = 10
    ): Promise<DailyWithdrawalPaginationResponse> {
        try {
            const skip = (page - 1) * limit;

            const withdrawals = await DailyWithdrawalModel.find()
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .exec();

            const totalCount = await DailyWithdrawalModel.countDocuments();

            return {
                withdrawals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error) {
            logger.error('Error in getAllDailyWithdrawals:', error);
            throw error;
        }
    }

    /**
     * Gets withdrawal records within a date range
     * @param startDate - Start date of the range
     * @param endDate - End date of the range
     * @param page - Page number (default: 1)
     * @param limit - Items per page (default: 10)
     * @returns Paginated list of withdrawal records in the date range
     */
    async getWithdrawalsInDateRange(
        startDate: Date,
        endDate: Date,
        page: number = 1,
        limit: number = 10
    ): Promise<DailyWithdrawalPaginationResponse> {
        try {
            const skip = (page - 1) * limit;

            const withdrawals = await DailyWithdrawalModel.find({
                date: { $gte: startDate, $lte: endDate }
            })
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .exec();

            const totalCount = await DailyWithdrawalModel.countDocuments({
                date: { $gte: startDate, $lte: endDate }
            });

            return {
                withdrawals,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error) {
            logger.error('Error in getWithdrawalsInDateRange:', error);
            throw error;
        }
    }

    /**
     * Gets withdrawal statistics for a date range
     * @param startDate - Start date
     * @param endDate - End date
     * @returns Withdrawal statistics
     */
    async getWithdrawalStats(startDate: Date, endDate: Date): Promise<{
        totalCount: number;
        totalAmount: number;
        averageAmount: number;
    }> {
        try {
            const result = await DailyWithdrawalModel.aggregate([
                {
                    $match: {
                        date: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCount: { $sum: 1 },
                        totalAmount: { $sum: "$totalAmount" },
                        averageAmount: { $avg: "$totalAmount" }
                    }
                }
            ]);

            if (result.length === 0) {
                return {
                    totalCount: 0,
                    totalAmount: 0,
                    averageAmount: 0
                };
            }

            return {
                totalCount: result[0].totalCount,
                totalAmount: result[0].totalAmount,
                averageAmount: result[0].averageAmount
            };
        } catch (error) {
            logger.error('Error in getWithdrawalStats:', error);
            return {
                totalCount: 0,
                totalAmount: 0,
                averageAmount: 0
            };
        }
    }
}

// Export a singleton instance
export const dailyWithdrawalRepository = new DailyWithdrawalRepository(); 