import { Request, Response, NextFunction } from 'express';
import { tombolaService } from '../../services/tombola.service';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { Types } from 'mongoose';

const log = logger.getLogger('TombolaController');

// Define structure for authenticated user info on Request object
// This should match what your actual auth middleware provides
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        // Add other user properties if needed (e.g., email, role)
    };
}

class TombolaController {

    /**
     * POST /api/tombolas/current/buy-ticket
     * Initiates the purchase of a ticket for the current tombola.
     * Requires user authentication.
     */
    async initiatePurchase(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        // Extract userId from authenticated request (provided by auth middleware)
        const userId = req.user?.userId;

        if (!userId) {
            log.warn('Initiate purchase failed: No userId found on authenticated request.');
            // This should ideally be caught by the auth middleware itself
            res.status(401).json({ success: false, message: 'Authentication required.' });
            return;
        }

        log.info(`Controller: Received initiate purchase request from user ${userId}`);

        try {
            const purchaseInfo = await tombolaService.initiateTicketPurchase(userId);
            res.status(200).json({
                success: true,
                message: purchaseInfo.message,
                data: {
                    tombolaMonthId: purchaseInfo.tombolaMonthId,
                    provisionalTicketId: purchaseInfo.provisionalTicketId,
                    paymentSessionId: purchaseInfo.paymentSessionId,
                    checkoutUrl: purchaseInfo.checkoutUrl,
                    clientSecret: purchaseInfo.clientSecret,
                    // Only send necessary info to frontend
                },
            });
        } catch (error: any) {
            log.error(`Controller: Error initiating ticket purchase for user ${userId}:`, error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                // Pass unexpected errors to the global error handler
                next(error);
            }
        }
    }

    /**
     * POST /api/tombolas/webhooks/payment-confirmation
     * Handles incoming webhook events from the payment service.
     */
    async handlePaymentWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Received payment webhook event.');
        // The request body structure depends entirely on what the payment service sends.
        // It now sends { sessionId, status, metadata }
        const { sessionId, status, metadata } = req.body;

        log.debug('Webhook payload:', { sessionId, status, metadata });

        // --- Handle Specific Event Types --- 
        // Check the 'status' field sent by the payment-service
        if (status === 'SUCCEEDED') { // Assuming PaymentStatus.SUCCEEDED corresponds to this string
            if (!sessionId) {
                log.error('Webhook processing failed: Missing session ID for payment success event.');
                res.status(400).json({ success: false, message: 'Missing session ID in webhook payload.' });
                return;
            }
            try {
                log.info(`Processing successful payment confirmation for session: ${sessionId}`);
                // Call the service method to handle confirmation and ticket creation
                await tombolaService.confirmTicketPurchase(sessionId, metadata);

                // Respond to the webhook provider quickly to acknowledge receipt
                res.status(200).json({ success: true, message: 'Webhook received and processed.' });

            } catch (error: any) {
                log.error(`Error processing payment success webhook for session ${sessionId}:`, error);
                // Determine appropriate status code based on error type
                const statusCode = error instanceof AppError ? error.statusCode : 500;
                // Respond with an error, but avoid complex logic here.
                // The service layer should handle the core business logic failures.
                res.status(statusCode).json({ success: false, message: `Error processing webhook: ${error.message}` });
            }
        } else {
            log.info(`Received webhook with non-successful status: ${status}`);
            // Acknowledge receipt of other event types we don't explicitly handle as success
            res.status(200).json({ success: true, message: `Webhook received (status: ${status}).` });
        }
    }

    /**
     * GET /api/tombolas
     * Retrieves a list of past tombola months (status=CLOSED).
     */
    async getTombolas(req: Request, res: Response, next: NextFunction): Promise<void> {
        // TODO: Extract pagination params (limit, page) from req.query
        const limit = parseInt(req.query.limit as string) || 10;
        const page = parseInt(req.query.page as string) || 1;
        const skip = (page - 1) * limit;

        log.info(`Controller: Received request for past tombolas (limit: ${limit}, page: ${page})`);
        try {
            const pastTombolas = await tombolaService.getPastTombolas(limit, skip);
            res.status(200).json({
                success: true,
                message: 'Past tombolas retrieved successfully.',
                data: pastTombolas,
                // TODO: Add pagination info (totalCount, totalPages)
            });
        } catch (error: any) {
            log.error('Controller: Error retrieving past tombolas:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/tombolas/current
     * Retrieves the details of the currently open tombola.
     * Retrieves the details of the tombola corresponding to the current calendar month and year.
     * Retrieves the details of the tombola currently marked with status 'open'.
     */
    async getCurrentTombola(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Controller: Received request for current month tombola');
        log.info('Controller: Received request for current OPEN tombola');
        try {
            /* // --- Calendar Month Implementation (Removed) ---
            const now = new Date();
            const currentMonth = now.getMonth() + 1; // JavaScript months are 0-11
            const currentYear = now.getFullYear();

            log.debug(`Looking for tombola for month: ${currentMonth}, year: ${currentYear}`);

            const currentTombola = await tombolaService.getTombolaByMonthYear(currentMonth, currentYear);
            */
            // --- Status-Based Implementation (Restored) ---
            const currentTombola = await tombolaService.getCurrentOpenTombola(); // Use status-based fetch

            if (!currentTombola) {
                // Adjusted message
                // res.status(404).json({ success: false, message: `No tombola found for the current month (${currentMonth}/${currentYear}).` });
                res.status(404).json({ success: false, message: 'No tombola is currently open.' }); // Restored message
                return;
            }
            res.status(200).json({
                success: true,
                // message: 'Current month tombola details retrieved successfully.', // Adjusted message
                message: 'Current open tombola details retrieved successfully.', // Restored message
                data: currentTombola,
            });
        } catch (error: any) {
            log.error('Controller: Error retrieving current month tombola:', error); // Adjusted log message
            log.error('Controller: Error retrieving current open tombola:', error); // Restored log message
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/tombolas/:monthId/winners
     * Retrieves the winners for a specific closed tombola month.
     * Public access.
     */
    async getWinners(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { monthId } = req.params;

        if (!Types.ObjectId.isValid(monthId)) {
            res.status(400).json({ success: false, message: 'Invalid Tombola Month ID format.' });
            return;
        }

        log.info(`Controller: Received request for winners of tombola month ${monthId}`);
        try {
            const winners = await tombolaService.getTombolaWinners(monthId);
            res.status(200).json({
                success: true,
                message: 'Tombola winners retrieved successfully.',
                data: winners,
            });
        } catch (error: any) {
            log.error(`Controller: Error retrieving winners for tombola ${monthId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/tombolas/tickets/me
     * Retrieves a paginated list of tickets purchased by the authenticated user.
     */
    async getMyTickets(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.userId;
        const limit = parseInt(req.query.limit as string) || 10;
        const page = parseInt(req.query.page as string) || 1;
        const skip = (page - 1) * limit;

        if (!userId) {
            res.status(401).json({ success: false, message: 'Authentication required.' });
            return;
        }

        log.info(`Controller: Received request for tickets for user ${userId} (limit: ${limit}, page: ${page})`);
        try {
            const result = await tombolaService.getUserTickets(userId, limit, skip);
            res.status(200).json({
                success: true,
                message: 'User tickets retrieved successfully.',
                data: result.tickets,
                pagination: {
                    totalCount: result.totalCount,
                    totalPages: Math.ceil(result.totalCount / limit),
                    currentPage: page,
                    limit: limit
                }
            });
        } catch (error: any) {
            log.error(`Controller: Error retrieving tickets for user ${userId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }
}

export const tombolaController = new TombolaController(); 