import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { partnerService } from '../../services/partner.service';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { PaginationOptions } from '../../types/express';

const log = logger.getLogger('PartnerController');

class PartnerController {

    /**
     * Get the logged-in user's partner details.
     * @route GET /api/partners/me
     */
    async getMyPartnerDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info(`Request received to get own partner details for user ${req.user?.userId}`);
        if (!req.user || !req.user.userId) {
            return next(new AppError('Authentication required: User ID not found in token.', 401));
        }

        try {
            const partnerDetails = await partnerService.getActivePartnerByUserId(req.user.userId);
            if (!partnerDetails) {
                // It's not necessarily an error if the user isn't a partner
                res.status(200).json({ success: true, data: null, message: 'User is not an active partner.' });
                return;
            }
            res.status(200).json({ success: true, data: partnerDetails });
        } catch (error) {
            log.error(`Error fetching own partner details for user ${req.user.userId}:`, error);
            next(error);
        }
    }

    /**
     * Get the logged-in user's partner commission transactions.
     * @route GET /api/partners/me/transactions
     */
    async getMyPartnerTransactions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info(`Request received to get own partner transactions for user ${req.user?.userId}`);
        if (!req.user || !req.user.userId) {
            return next(new AppError('Authentication required: User ID not found in token.', 401));
        }

        try {
            const { page = 1, limit = 10 } = req.query;
            const pagination: PaginationOptions = {
                page: parseInt(page as string, 10) || 1,
                limit: parseInt(limit as string, 10) || 10,
            };

            const transactionsData = await partnerService.getPartnerTransactions(req.user.userId, pagination.page, pagination.limit);

            res.status(200).json({
                success: true, data: transactionsData.docs, pagination: {
                    totalDocs: transactionsData.totalDocs,
                    limit: transactionsData.limit,
                    page: transactionsData.page,
                    totalPages: transactionsData.totalPages,
                    hasNextPage: transactionsData.hasNextPage,
                    hasPrevPage: transactionsData.hasPrevPage,
                    nextPage: transactionsData.nextPage,
                    prevPage: transactionsData.prevPage,
                }
            });
        } catch (error) {
            log.error(`Error fetching own partner transactions for user ${req.user.userId}:`, error);
            next(error);
        }
    }
}

export const partnerController = new PartnerController(); 