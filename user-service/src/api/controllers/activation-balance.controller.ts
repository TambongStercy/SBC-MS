import { Response } from 'express';
import { ActivationBalanceService } from '../../services/activation-balance.service';
import { SponsorableSubscriptionType } from '../../config/activation-pricing';
import logger from '../../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { Types } from 'mongoose';

export class ActivationBalanceController {
    private activationBalanceService: ActivationBalanceService;
    private log = logger.getLogger('ActivationBalanceController');

    constructor() {
        this.activationBalanceService = new ActivationBalanceService();
    }

    /**
     * Get user's activation balance and summary
     * @route GET /api/activation-balance
     */
    async getActivationBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const summary = await this.activationBalanceService.getActivationBalanceSummary(userId);

            res.status(200).json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            this.log.error('Error fetching activation balance:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to fetch activation balance'
            });
        }
    }

    /**
     * Get pricing information for activation types
     * @route GET /api/activation-balance/pricing
     */
    async getPricing(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const pricing = this.activationBalanceService.getPricing();
            const minimums = this.activationBalanceService.getMinimumTransferAmounts();

            res.status(200).json({
                success: true,
                data: {
                    pricing,
                    minimumTransfers: minimums
                }
            });
        } catch (error: any) {
            this.log.error('Error fetching pricing:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch pricing information'
            });
        }
    }

    /**
     * Transfer funds from main balance to activation balance
     * @route POST /api/activation-balance/transfer
     */
    async transferToActivationBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const { amount } = req.body;

            if (!amount || typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({
                    success: false,
                    message: 'Valid amount is required (positive number)'
                });
                return;
            }

            const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;

            const result = await this.activationBalanceService.transferToActivationBalance(
                userId,
                amount,
                ipAddress
            );

            res.status(200).json({
                success: true,
                message: `Successfully transferred ${amount} XAF to activation balance`,
                data: result
            });
        } catch (error: any) {
            this.log.error('Error transferring to activation balance:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to transfer to activation balance'
            });
        }
    }

    /**
     * Transfer activation balance to another user
     * @route POST /api/activation-balance/transfer-to-user
     */
    async transferActivationToUser(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const { recipientId, amount } = req.body;

            if (!recipientId) {
                res.status(400).json({
                    success: false,
                    message: 'Recipient ID is required'
                });
                return;
            }

            if (!Types.ObjectId.isValid(recipientId)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid recipient ID format'
                });
                return;
            }

            if (!amount || typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({
                    success: false,
                    message: 'Valid amount is required (positive number)'
                });
                return;
            }

            if (recipientId === userId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot transfer to yourself'
                });
                return;
            }

            const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;

            const result = await this.activationBalanceService.transferActivationToUser(
                userId,
                recipientId,
                amount,
                ipAddress
            );

            res.status(200).json({
                success: true,
                message: `Successfully transferred ${amount} XAF activation balance`,
                data: result
            });
        } catch (error: any) {
            this.log.error('Error transferring activation balance to user:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to transfer activation balance'
            });
        }
    }

    /**
     * Get referrals that can be activated/upgraded
     * @route GET /api/activation-balance/referrals
     */
    async getReferralsForActivation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const filter = req.query.filter as 'all' | 'activatable' | 'upgradable' | undefined;

            // Validate filter
            if (filter && !['all', 'activatable', 'upgradable'].includes(filter)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid filter. Must be "all", "activatable", or "upgradable"'
                });
                return;
            }

            const result = await this.activationBalanceService.getReferralsForActivation(
                userId,
                page,
                limit,
                filter
            );

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            this.log.error('Error fetching referrals for activation:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to fetch referrals'
            });
        }
    }

    /**
     * Sponsor a referral's account activation
     * @route POST /api/activation-balance/sponsor
     */
    async sponsorReferralActivation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const { beneficiaryId, subscriptionType } = req.body;

            if (!beneficiaryId) {
                res.status(400).json({
                    success: false,
                    message: 'Beneficiary ID is required'
                });
                return;
            }

            if (!Types.ObjectId.isValid(beneficiaryId)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid beneficiary ID format'
                });
                return;
            }

            if (!subscriptionType || !['CLASSIQUE', 'CIBLE', 'UPGRADE'].includes(subscriptionType)) {
                res.status(400).json({
                    success: false,
                    message: 'Valid subscription type is required (CLASSIQUE, CIBLE, or UPGRADE)'
                });
                return;
            }

            if (beneficiaryId === userId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot sponsor your own account'
                });
                return;
            }

            const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;

            const result = await this.activationBalanceService.sponsorReferralActivation(
                userId,
                beneficiaryId,
                subscriptionType as SponsorableSubscriptionType,
                ipAddress
            );

            res.status(200).json({
                success: true,
                message: `Successfully sponsored ${subscriptionType} activation`,
                data: result
            });
        } catch (error: any) {
            this.log.error('Error sponsoring referral activation:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to sponsor activation'
            });
        }
    }

    /**
     * Get sponsored activation history
     * @route GET /api/activation-balance/history
     */
    async getSponsoredActivationHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User ID not found in request' });
                return;
            }

            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await this.activationBalanceService.getSponsoredActivationHistory(
                userId,
                page,
                limit
            );

            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error: any) {
            this.log.error('Error fetching sponsored activation history:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to fetch history'
            });
        }
    }
}

// Export singleton instance
export const activationBalanceController = new ActivationBalanceController();
