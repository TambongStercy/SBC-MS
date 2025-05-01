import { Types } from 'mongoose';
import { dailyWithdrawalRepository, DailyWithdrawalPaginationResponse } from '../database/repositories/daily-withdrawal.repository';
import logger from '../utils/logger';

export class DailyWithdrawalService {
    private log = logger.getLogger('DailyWithdrawalService');

    /**
     * Create a new daily withdrawal record
     * @param userId User ID
     * @param date Date of withdrawal 
     * @param amount Withdrawal amount
     * @returns Created withdrawal record
     */
    async createWithdrawal(userId: string | Types.ObjectId, date: Date, amount: number): Promise<any> {
        try {
            return await dailyWithdrawalRepository.createDailyWithdrawal({
                userId: new Types.ObjectId(userId.toString()),
                date,
                totalAmount: amount,
                count: 1
            });
        } catch (error) {
            this.log.error('Error creating daily withdrawal record:', error);
            throw error;
        }
    }

    /**
     * Update an existing withdrawal record
     * @param id Withdrawal record ID
     * @param data Update data
     * @returns Updated withdrawal record
     */
    async updateWithdrawal(id: string | Types.ObjectId, data: {
        totalAmount?: number;
        count?: number;
    }): Promise<any | null> {
        try {
            return await dailyWithdrawalRepository.updateDailyWithdrawal(id, data);
        } catch (error) {
            this.log.error('Error updating daily withdrawal record:', error);
            throw error;
        }
    }

    /**
     * Get a withdrawal record for a specific date
     * @param userId User ID
     * @param date Date to retrieve record for
     * @returns Withdrawal record or null if not found
     */
    async getWithdrawalByDate(userId: string | Types.ObjectId, date: Date): Promise<any | null> {
        try {
            return await dailyWithdrawalRepository.getDailyWithdrawalByUserAndDate(userId, date);
        } catch (error) {
            this.log.error('Error getting withdrawal record by date:', error);
            return null;
        }
    }

    /**
     * Get all withdrawal records with pagination
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 10)
     * @returns Paginated list of withdrawal records
     */
    async getAllWithdrawals(
        page: number = 1,
        limit: number = 10
    ): Promise<DailyWithdrawalPaginationResponse> {
        try {
            return await dailyWithdrawalRepository.getAllDailyWithdrawals(page, limit);
        } catch (error) {
            this.log.error('Error getting all withdrawal records:', error);
            return {
                withdrawals: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Get withdrawals within a date range with pagination
     * @param startDate Start date
     * @param endDate End date
     * @param page Page number (default: 1)
     * @param limit Items per page (default: 10)
     * @returns Paginated list of withdrawal records in the date range
     */
    async getWithdrawalsInDateRange(
        startDate: Date,
        endDate: Date,
        page: number = 1,
        limit: number = 10
    ): Promise<DailyWithdrawalPaginationResponse> {
        try {
            return await dailyWithdrawalRepository.getWithdrawalsInDateRange(
                startDate,
                endDate,
                page,
                limit
            );
        } catch (error) {
            this.log.error('Error getting withdrawals in date range:', error);
            return {
                withdrawals: [],
                totalCount: 0,
                totalPages: 0,
                page
            };
        }
    }

    /**
     * Get withdrawal statistics for a date range
     * @param startDate Start date
     * @param endDate End date
     * @returns Withdrawal statistics
     */
    async getWithdrawalStats(
        startDate: Date,
        endDate: Date
    ): Promise<{
        totalCount: number;
        totalAmount: number;
        averageAmount: number;
    }> {
        try {
            return await dailyWithdrawalRepository.getWithdrawalStats(startDate, endDate);
        } catch (error) {
            this.log.error('Error getting withdrawal statistics:', error);
            return {
                totalCount: 0,
                totalAmount: 0,
                averageAmount: 0
            };
        }
    }
}

// Export singleton instance
export const dailyWithdrawalService = new DailyWithdrawalService(); 