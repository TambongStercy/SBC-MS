import { Request, Response } from 'express';
import { PRODUCT_PLAN_IDS, getOffers, initiateProductPurchase, handleProductPayment } from '../../services/products.service';
import { SubscriptionService } from '../../services/subscription.service';
import logger from '../../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { SubscriptionType, SubscriptionCategory } from '../../database/models/subscription.model';
import { Types } from 'mongoose'; // Import Types for ObjectId validation

export class SubscriptionController {
    private subscriptionService: SubscriptionService;
    private log = logger.getLogger('SubscriptionController');

    constructor() {
        this.subscriptionService = new SubscriptionService();
    }

    /**
     * Get all user subscriptions with pagination
     * @param req Express request (supports ?category=registration|feature)
     * @param res Express response
     */
    async getUserSubscriptions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const category = req.query.category as string;

            // Validate category if provided
            if (category && !['registration', 'feature'].includes(category)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid category parameter. Must be "registration" or "feature".'
                });
                return;
            }

            const result = await this.subscriptionService.getUserSubscriptions(
                userId,
                page,
                limit,
                category as SubscriptionCategory | undefined
            );

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.log.error('Error fetching user subscriptions:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch subscriptions'
            });
        }
    }

    /**
     * Get active subscriptions for a user with pagination
     * @param req Express request
     * @param res Express response
     */
    async getActiveSubscriptions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await this.subscriptionService.getActiveSubscriptions(userId, page, limit);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.log.error('Error fetching active subscriptions:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch active subscriptions'
            });
        }
    }

    /**
     * Get expired subscriptions for a user with pagination
     * @param req Express request
     * @param res Express response
     */
    async getExpiredSubscriptions(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await this.subscriptionService.getExpiredSubscriptions(userId, page, limit);

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.log.error('Error fetching expired subscriptions:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch expired subscriptions'
            });
        }
    }

    /**
     * Check if user has an active subscription of a specific type
     * @param req Express request
     * @param res Express response
     */
    async checkSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const subscriptionType = req.params.type as string;
            if (!subscriptionType || !(subscriptionType.toUpperCase() in SubscriptionType)) {
                res.status(400).json({ success: false, message: 'Invalid subscription type provided. Must be CLASSIQUE, CIBLE, or RELANCE.' });
                return;
            }

            const hasSubscription = await this.subscriptionService.hasSubscription(userId, SubscriptionType[subscriptionType.toUpperCase() as keyof typeof SubscriptionType]);

            res.status(200).json({
                success: true,
                data: { hasSubscription }
            });
        } catch (error) {
            this.log.error('Error checking subscription:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check subscription status'
            });
        }
    }

    /**
     * GET /plans - Get list of available subscription plans
     * Query parameter: paymentMethod=crypto|traditional
     */
    async getAvailablePlans(req: Request, res: Response): Promise<void> {
        try {
            const paymentMethod = req.query.paymentMethod as string;
            
            // Validate payment method if provided
            if (paymentMethod && !['crypto', 'traditional'].includes(paymentMethod)) {
                res.status(400).json({ success: false, message: 'Invalid paymentMethod query parameter. Must be "crypto" or "traditional".' });
                return;
            }

            const plans = this.subscriptionService.getAvailablePlans(paymentMethod as 'crypto' | 'traditional' | undefined);
            res.status(200).json({ success: true, data: plans });
        } catch (error) {
            this.log.error('Error fetching available plans:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch subscription plans';
            res.status(500).json({ success: false, message });
        }
    }

    /**
     * GET /offers - The packs and add-ons as this member can buy them now
     * (upgrade prices, what they already own), for ?paymentMethod=traditional|crypto.
     */
    async getOffers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) { res.status(401).json({ success: false, message: 'User ID not found in request' }); return; }
            const paymentMethod = req.query.paymentMethod === 'crypto' ? 'crypto' : 'traditional';
            res.status(200).json({ success: true, data: await getOffers(userId, paymentMethod) });
        } catch (error) {
            this.log.error('Error fetching offers:', error);
            res.status(500).json({ success: false, message: 'Impossible de charger les offres.' });
        }
    }

    /**
     * POST /purchase - Initiate purchase for a specific plan type
     */
    async initiatePurchase(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const { planType, paymentMethod } = req.body;
            const isProduct = PRODUCT_PLAN_IDS.includes(planType);
            if (!planType || !(isProduct || planType in SubscriptionType)) {
                res.status(400).json({ success: false, message: 'Missing or invalid planType in request body.' });
                return;
            }

            // Validate payment method if provided
            if (paymentMethod && !['crypto', 'traditional'].includes(paymentMethod)) {
                res.status(400).json({ success: false, message: 'Invalid paymentMethod. Must be "crypto" or "traditional".' });
                return;
            }

            // Pack Winner and the add-ons (PRO, MISE_EN_AVANT) have their own pricing and activation.
            if (isProduct) {
                const result = await initiateProductPurchase(userId, planType, paymentMethod || 'traditional');
                res.status(200).json({ success: true, data: result });
                return;
            }

            const result = await this.subscriptionService.initiateSubscriptionPurchase(
                userId, 
                planType as SubscriptionType, 
                paymentMethod as 'crypto' | 'traditional' | undefined
            );

            res.status(200).json({ success: true, data: result });

        } catch (error) {
            this.log.error('Error initiating subscription purchase:', error);
            const message = error instanceof Error ? error.message : 'Failed to initiate subscription purchase';
            const statusCode = (error as any).status || (error instanceof Error && error.message.includes('already have an active') ? 409 : 500);
            res.status(statusCode).json({ success: false, message });
        }
    }

    /**
     * POST /upgrade - Initiate upgrade from CLASSIQUE to CIBLE
     */
    async initiateUpgrade(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const { paymentMethod } = req.body;

            // Validate payment method if provided
            if (paymentMethod && !['crypto', 'traditional'].includes(paymentMethod)) {
                res.status(400).json({ success: false, message: 'Invalid paymentMethod. Must be "crypto" or "traditional".' });
                return;
            }

            const result = await this.subscriptionService.initiateSubscriptionUpgrade(
                userId, 
                paymentMethod as 'crypto' | 'traditional' | undefined
            );

            res.status(200).json({ success: true, data: result });

        } catch (error) {
            this.log.error('Error initiating subscription upgrade:', error);
            const message = error instanceof Error ? error.message : 'Failed to initiate subscription upgrade';
            const statusCode = (error instanceof Error && (error.message.includes('No active CLASSIQUE subscription') || error.message.includes('already have the CIBLE')) ? 400 : 500);
            res.status(statusCode).json({ success: false, message });
        }
    }

    /**
     * POST /webhooks/payment-confirmation - Handle payment success webhook
     */
    async handlePaymentWebhook(req: Request, res: Response): Promise<void> {
        const { sessionId, status, metadata } = req.body;
        this.log.info(`Received payment webhook: Session=${sessionId}, Status=${status}`);
        this.log.debug('Webhook metadata:', metadata);

        if (status !== 'SUCCEEDED') {
            this.log.warn(`Ignoring non-successful payment webhook status: ${status} for session ${sessionId}`);
            res.status(200).json({ success: true, message: 'Webhook received but status not successful.' });
            return;
        }

        // Pack Winner, PRO, MISE_EN_AVANT and extra numbers carry `product`.
        if (metadata?.originatingService === 'user-service' && metadata?.product) {
            try {
                await handleProductPayment(sessionId, metadata);
                res.status(200).json({ success: true, message: 'Product applied.' });
            } catch (error: any) {
                this.log.error(`Error applying product payment ${sessionId}:`, error);
                res.status(error?.status === 400 ? 400 : 500).json({ success: false, message: error?.message || 'Failed to apply product' });
            }
            return;
        }

        if (!metadata || metadata.originatingService !== 'user-service' || !metadata.userId || !metadata.planId || !(metadata.planId in SubscriptionType)) {
            this.log.error('Invalid or missing metadata in subscription payment webhook', { sessionId, metadata });
            res.status(400).json({ success: false, message: 'Invalid or missing metadata for subscription activation.' });
            return;
        }

        try {
            await this.subscriptionService.handleSubscriptionPaymentSuccess(sessionId, metadata);
            this.log.info(`Subscription activation/update successful for session ${sessionId}`);
            res.status(200).json({ success: true, message: 'Subscription activated successfully.' });

        } catch (error) {
            this.log.error(`Error processing successful payment webhook for session ${sessionId}:`, error);
            const message = error instanceof Error ? error.message : 'Failed to activate subscription after payment confirmation';
            res.status(500).json({ success: false, message });
        }
    }
}

// Export singleton instance
export const subscriptionController = new SubscriptionController(); 