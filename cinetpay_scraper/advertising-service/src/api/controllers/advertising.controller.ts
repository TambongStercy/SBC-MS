import { Request, Response, NextFunction } from 'express';
import { advertisingService } from '../../services/advertising.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';
// Import repository and Types
import { advertisementRepository } from '../../database/repositories/advertisement.repository';
import { Types, SortOrder } from 'mongoose';
const log = logger.getLogger('AdvertisingController');

export class AdvertisingController {

    /**
     * @route   GET /api/advertising/packs
     * @desc    Get all active advertising packs
     * @access  Public
     */
    async getAdPacks(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            log.info('Request received for getting ad packs');
            const packs = await advertisingService.getAdPacks();
            res.status(200).json({
                success: true,
                message: 'Active ad packs retrieved successfully.',
                data: packs,
            });
        } catch (error) {
            log.error('Error retrieving ad packs:', error);
            next(error); // Pass error to the centralized error handler
        }
    }

    /**
     * @route   POST /api/advertising/ads
     * @desc    Create a new advertisement (initiates payment)
     * @access  Private (Requires user authentication)
     */
    async createAdvertisement(req: Request, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        const { packId, content, targetCriteria } = req.body;

        if (!userId) {
            log.warn('Attempt to create advertisement without user ID in request.');
            return next(new AppError('Authentication required', 401));
        }

        if (!packId || !content || typeof content !== 'object' || !content.text) {
            log.warn('Invalid request body for creating advertisement.', { body: req.body });
            return next(new AppError('Invalid input: packId and content (with text) are required.', 400));
        }

        try {
            log.info(`Request received to create advertisement for user ${userId}, pack ${packId}`);
            const paymentDetails = await advertisingService.createAdvertisement(userId, packId, content, targetCriteria);
            res.status(201).json({
                success: true,
                message: 'Advertisement creation initiated. Proceed with payment.',
                data: paymentDetails,
            });
        } catch (error) {
            log.error(`Error initiating advertisement creation for user ${userId}:`, error);
            next(error);
        }
    }

    /**
     * @route   POST /api/advertising/webhooks/payment
     * @desc    Handle payment confirmation webhook
     * @access  Internal (Requires service authentication or specific validation)
     */
    async handlePaymentWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        // TODO: Add proper webhook validation (e.g., signature verification if provider supports it)
        const event = req.body; // Payload from the payment service webhook

        log.info('Received payment webhook event');
        log.debug('Webhook payload:', event);

        // Basic validation of expected event structure (adjust based on actual payment service payload)
        // This assumes the payment service sends events like Stripe
        if (event.type === 'payment_intent.succeeded' && event.data?.object) {
            const paymentIntent = event.data.object;
            const paymentSessionId = paymentIntent.id; // Use the payment intent ID as the session ID
            const metadata = paymentIntent.metadata;

            if (!paymentSessionId || !metadata) {
                log.warn('Webhook ignored: Missing payment intent ID or metadata.', { event });
                res.status(400).send('Webhook Error: Missing required data');
                return;
            }

            try {
                log.info(`Processing successful payment intent: ${paymentSessionId}`);
                // Pass the ID and metadata to the service layer
                await advertisingService.confirmAdPayment(paymentSessionId, metadata);
                log.info(`Webhook processed successfully for payment intent: ${paymentSessionId}`);
                res.status(200).json({ received: true });
            } catch (error) {
                log.error(`Error processing payment webhook for intent ${paymentSessionId}:`, error);
                res.status(500).json({ received: false, error: 'Internal server error processing webhook' });
            }
        } else if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data?.object;
            log.warn('Received payment failed event', { paymentIntentId: paymentIntent?.id });
            // TODO: Implement logic for handling failed payment if necessary
            // e.g., update the Advertisement status to PAYMENT_FAILED
            res.status(200).json({ received: true, message: 'Payment failed event noted.' });
        } else {
            log.warn('Webhook ignored: Unhandled event type or structure.', { type: event.type });
            res.status(400).send(`Webhook Error: Unhandled event type ${event.type}`);
        }
    }

    /**
     * @route   GET /api/advertising/ads/me
     * @desc    Get advertisements created by the logged-in user
     * @access  Private
     */
    async getUserAdvertisements(req: Request, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        try {
            log.info(`Fetching advertisements for user ${userId}, page ${page}, limit ${limit}`);
            // Use the generic find method with a query for userId and pagination options
            const query = { userId: new Types.ObjectId(userId) }; // Ensure userId is ObjectId if stored as such
            // Explicitly cast -1 to SortOrder
            const options = { limit, skip, sort: { createdAt: -1 as SortOrder } };
            const advertisements = await advertisementRepository.find(query, options);
            const totalCount = await advertisementRepository.count(query); // Count documents matching the query

            res.status(200).json({
                success: true,
                message: 'User advertisements retrieved successfully.',
                data: advertisements,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                },
            });
        } catch (error) {
            log.error(`Error retrieving advertisements for user ${userId}:`, error);
            next(error);
        }
    }

    /**
    * @route   GET /api/advertising/ads/:advertisementId
    * @desc    Get a specific advertisement by its ID
    * @access  Private (or Public depending on requirements)
    */
    async getAdvertisementById(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { advertisementId } = req.params;
        const userId = req.user?.id; // Get user ID if needed for authorization

        if (!advertisementId) {
            return next(new AppError('Advertisement ID is required', 400));
        }

        try {
            log.info(`Fetching advertisement details for ID: ${advertisementId}`);
            // Use the specific findByAdvertisementId method
            const advertisement = await advertisementRepository.findByAdvertisementId(advertisementId);

            if (!advertisement) {
                return next(new AppError('Advertisement not found', 404));
            }

            // --- Authorization Check (Example) ---
            // If only the owner or an admin can view details:
            // if (advertisement.userId.toString() !== userId /* && req.user?.role !== 'admin' */) {
            //     log.warn(`User ${userId} attempt to access unauthorized ad ${advertisementId}`);
            //     return next(new AppError('Forbidden', 403));
            // }
            // --- End Authorization Check ---

            res.status(200).json({
                success: true,
                message: 'Advertisement details retrieved successfully.',
                data: advertisement,
            });
        } catch (error) {
            log.error(`Error retrieving advertisement ${advertisementId}:`, error);
            next(error);
        }
    }

    /**
     * @route   GET /api/advertising/ads/display
     * @desc    Get active advertisements for display (e.g., in the app feed)
     * @access  Public
     */
    async getAdvertisementsForDisplay(req: Request, res: Response, next: NextFunction): Promise<void> {
        // TODO: Implement filtering (region, interests etc.) and pagination
        try {
            log.info('Fetching advertisements for display');
            // Assuming advertisementRepository has findActiveForDisplay method
            const advertisements = await advertisementRepository.findActiveForDisplay();
            res.status(200).json({
                success: true,
                message: 'Active advertisements retrieved successfully.',
                data: advertisements,
            });
        } catch (error) {
            log.error('Error retrieving advertisements for display:', error);
            next(error);
        }
    }

    /**
     * @route   PUT /api/advertising/ads/:advertisementId
     * @desc    Update the content of an existing advertisement
     * @access  Private (Owner only)
     */
    async updateAdvertisement(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { advertisementId } = req.params;
        const userId = req.user?.id;
        const { content } = req.body; // Expecting updated content in the body

        if (!userId) {
            return next(new AppError('Authentication required', 401));
        }

        if (!advertisementId) {
            return next(new AppError('Advertisement ID is required in URL path', 400));
        }

        // Validate new content
        if (!content || typeof content !== 'object' || !content.text) {
            log.warn(`Invalid request body for updating advertisement ${advertisementId}.`, { body: req.body });
            return next(new AppError('Invalid input: content (with text) is required.', 400));
        }

        try {
            log.info(`Controller: User ${userId} request to update Ad ${advertisementId}`);
            const updatedAdvertisement = await advertisingService.updateAdvertisementContent(
                userId,
                advertisementId,
                content
            );
            res.status(200).json({
                success: true,
                message: 'Advertisement content updated successfully.',
                data: updatedAdvertisement,
            });
        } catch (error) {
            log.error(`Controller: Error updating advertisement ${advertisementId} by user ${userId}:`, error);
            next(error);
        }
    }

}

export const advertisingController = new AdvertisingController();