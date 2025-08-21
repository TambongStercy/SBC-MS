import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';
import { TransactionRecoveryService } from '../../scripts/transaction-recovery.script';
import { recoverUserTransactionRepository } from '../../database/repositories/recover-user-transaction.repository';
import { RecoveryProvider, RecoveryTransactionType, RecoveryStatus } from '../../database/models/recover-user-transaction.model';

const log = logger.getLogger('RecoveryController');

export class RecoveryController {
    private recoveryService: TransactionRecoveryService;

    constructor() {
        this.recoveryService = new TransactionRecoveryService();
    }

    /**
     * [INTERNAL] Process user registration to restore recoverable transactions
     * @route POST /api/internal/recovery/process-user-registration
     * @access Internal Service Request
     */
    public processUserRegistration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { userId, email, phoneNumber } = req.body;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            log.info(`Processing user registration recovery for user: ${userId}`);

            const restoredCount = await this.recoveryService.processUserRegistration(
                userId,
                email,
                phoneNumber
            );

            res.status(200).json({
                success: true,
                message: `Successfully processed user registration recovery`,
                data: {
                    restoredCount,
                    message: restoredCount > 0 
                        ? `Restored ${restoredCount} transactions`
                        : 'No recoverable transactions found'
                }
            });

        } catch (error: any) {
            log.error('Error processing user registration recovery:', error);
            next(error);
        }
    };

    /**
     * [INTERNAL] Get recovery statistics for a user
     * @route GET /api/internal/recovery/user-stats
     * @access Internal Service Request
     */
    public getUserRecoveryStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { email, phoneNumber } = req.query;

            log.info(`Getting user recovery stats for email: ${email}, phone: ${phoneNumber}`);

            const records = await recoverUserTransactionRepository.findByEmailOrPhoneNotRestored(
                email as string,
                phoneNumber as string
            );

            const stats = {
                totalRecoverable: records.length,
                totalAmount: records.reduce((sum, record) => sum + record.amount, 0),
                byProvider: records.reduce((acc, record) => {
                    acc[record.provider] = (acc[record.provider] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>)
            };

            res.status(200).json({
                success: true,
                data: stats
            });

        } catch (error: any) {
            log.error('Error getting user recovery stats:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Get overall recovery statistics
     * @route GET /api/admin/recovery/stats
     * @access Admin
     */
    public getRecoveryStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            log.info('Admin request: Get recovery statistics');

            const stats = await recoverUserTransactionRepository.getRecoveryStats();

            res.status(200).json({
                success: true,
                message: 'Recovery statistics retrieved successfully',
                data: stats
            });

        } catch (error: any) {
            log.error('Error getting recovery statistics:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] List recovery records with filters and pagination
     * @route GET /api/admin/recovery/records
     * @access Admin
     */
    public listRecoveryRecords = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const {
                page = '1',
                limit = '20',
                provider,
                transactionType,
                recoveryStatus,
                userEmail,
                userPhoneNumber,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query as { [key: string]: string };

            log.info('Admin request: List recovery records with filters');

            const filters: any = {};
            if (provider) filters.provider = provider as RecoveryProvider;
            if (transactionType) filters.transactionType = transactionType as RecoveryTransactionType;
            if (recoveryStatus) filters.recoveryStatus = recoveryStatus as RecoveryStatus;
            if (userEmail) filters.userEmail = userEmail;
            if (userPhoneNumber) filters.userPhoneNumber = userPhoneNumber;

            const options = {
                page: parseInt(page, 10) || 1,
                limit: Math.min(parseInt(limit, 10) || 20, 100), // Max 100 per page
                sortBy,
                sortOrder: sortOrder as 'asc' | 'desc'
            };

            const result = await recoverUserTransactionRepository.findWithFilters(filters, options);

            res.status(200).json({
                success: true,
                message: 'Recovery records retrieved successfully',
                data: result.records,
                pagination: {
                    currentPage: result.page,
                    totalPages: result.totalPages,
                    totalRecords: result.total,
                    limit: options.limit
                }
            });

        } catch (error: any) {
            log.error('Error listing recovery records:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Manually run recovery for a list of transaction references
     * @route POST /api/admin/recovery/run
     * @access Admin
     */
    public runRecovery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { provider, transactionType, references } = req.body;

            if (!provider || !transactionType || !Array.isArray(references) || references.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Provider, transaction type, and references array are required'
                });
                return;
            }

            if (!Object.values(RecoveryProvider).includes(provider)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid provider. Must be cinetpay or feexpay'
                });
                return;
            }

            if (!Object.values(RecoveryTransactionType).includes(transactionType)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid transaction type. Must be payment or payout'
                });
                return;
            }

            log.info(`Admin initiated recovery: ${provider} ${transactionType} - ${references.length} references`);

            const result = await this.recoveryService.recoverTransactions(
                provider as RecoveryProvider,
                references,
                transactionType as RecoveryTransactionType
            );

            res.status(200).json({
                success: true,
                message: 'Recovery process completed',
                data: result
            });

        } catch (error: any) {
            log.error('Error running recovery:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Mark recovery record as restored manually
     * @route POST /api/admin/recovery/records/:id/mark-restored
     * @access Admin
     */
    public markRecordAsRestored = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;
            const { restoredUserId, restoredTransactionId } = req.body;

            if (!restoredUserId || !restoredTransactionId) {
                res.status(400).json({
                    success: false,
                    message: 'Restored user ID and transaction ID are required'
                });
                return;
            }

            log.info(`Admin marking recovery record ${id} as restored`);

            const updatedRecord = await recoverUserTransactionRepository.markAsRestored(
                id as any,
                restoredUserId as any,
                restoredTransactionId
            );

            if (!updatedRecord) {
                res.status(404).json({
                    success: false,
                    message: 'Recovery record not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Recovery record marked as restored',
                data: updatedRecord
            });

        } catch (error: any) {
            log.error('Error marking record as restored:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Get recovery record details
     * @route GET /api/admin/recovery/records/:id
     * @access Admin
     */
    public getRecoveryRecord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            log.info(`Admin request: Get recovery record ${id}`);

            const record = await recoverUserTransactionRepository.findById(id);

            if (!record) {
                res.status(404).json({
                    success: false,
                    message: 'Recovery record not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Recovery record retrieved successfully',
                data: record
            });

        } catch (error: any) {
            log.error('Error getting recovery record:', error);
            next(error);
        }
    };
}

export const recoveryController = new RecoveryController();