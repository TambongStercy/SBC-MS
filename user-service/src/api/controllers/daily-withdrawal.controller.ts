import { Request, Response } from 'express';
import { dailyWithdrawalService } from '../../services/daily-withdrawal.service';
import logger from '../../utils/logger';

export class DailyWithdrawalController {
    private log = logger.getLogger('DailyWithdrawalController');

    /**
     * Get all withdrawal records with pagination
     * @param req Express request
     * @param res Express response
     */
    async getAllWithdrawals(req: Request, res: Response): Promise<void> {
        try {
            // Check admin permissions here if needed
            
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await dailyWithdrawalService.getAllWithdrawals(page, limit);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.log.error('Error getting all withdrawal records:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch withdrawal records'
            });
        }
    }

    /**
     * Get withdrawals within a date range
     * @param req Express request
     * @param res Express response
     */
    async getWithdrawalsInDateRange(req: Request, res: Response): Promise<void> {
        try {
            // Check admin permissions here if needed
            
            const { startDate, endDate } = req.query;
            if (!startDate || !endDate) {
                res.status(400).json({
                    success: false,
                    message: 'Start date and end date are required'
                });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await dailyWithdrawalService.getWithdrawalsInDateRange(
                new Date(startDate as string),
                new Date(endDate as string),
                page,
                limit
            );

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.log.error('Error getting withdrawals in date range:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch withdrawal records'
            });
        }
    }

    /**
     * Get withdrawal statistics for a date range
     * @param req Express request
     * @param res Express response
     */
    async getWithdrawalStats(req: Request, res: Response): Promise<void> {
        try {
            // Check admin permissions here if needed
            
            const { startDate, endDate } = req.query;
            if (!startDate || !endDate) {
                res.status(400).json({
                    success: false,
                    message: 'Start date and end date are required'
                });
                return;
            }

            const stats = await dailyWithdrawalService.getWithdrawalStats(
                new Date(startDate as string),
                new Date(endDate as string)
            );

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            this.log.error('Error getting withdrawal statistics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch withdrawal statistics'
            });
        }
    }
}

// Export singleton instance
export const dailyWithdrawalController = new DailyWithdrawalController(); 