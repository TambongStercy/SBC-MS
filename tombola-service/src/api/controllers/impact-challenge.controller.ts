import { Request, Response, NextFunction } from 'express';
import { impactChallengeService } from '../../services/impact-challenge.service';
import { entrepreneurService } from '../../services/entrepreneur.service';
import { challengeVoteService } from '../../services/challenge-vote.service';
import { ChallengeStatus } from '../../database/models/impact-challenge.model';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('ImpactChallengeController');

// Authenticated request interface
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        role?: string;
    };
}

class ImpactChallengeController {

    // ================== PUBLIC ENDPOINTS ==================

    /**
     * GET /api/challenges/current
     * Gets the currently active challenge.
     */
    async getCurrentChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const challenge = await impactChallengeService.getCurrentChallenge();

            if (!challenge) {
                res.status(404).json({ success: false, message: 'No active challenge found' });
                return;
            }

            // Get entrepreneurs for the challenge
            const entrepreneurs = await entrepreneurService.listEntrepreneursByChallenge(
                challenge._id.toString(),
                true // approved only
            );

            res.status(200).json({
                success: true,
                data: {
                    challenge,
                    entrepreneurs
                }
            });
        } catch (error: any) {
            log.error('Error getting current challenge:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/:challengeId
     * Gets challenge details by ID.
     */
    async getChallengeById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const challenge = await impactChallengeService.getChallengeById(challengeId);

            if (!challenge) {
                res.status(404).json({ success: false, message: 'Challenge not found' });
                return;
            }

            res.status(200).json({ success: true, data: challenge });
        } catch (error: any) {
            log.error('Error getting challenge:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/:challengeId/entrepreneurs
     * Gets entrepreneurs for a challenge.
     */
    async getEntrepreneurs(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const approvedOnly = req.query.approved !== 'false';

            const entrepreneurs = await entrepreneurService.listEntrepreneursByChallenge(
                challengeId,
                approvedOnly
            );

            res.status(200).json({ success: true, data: entrepreneurs });
        } catch (error: any) {
            log.error('Error getting entrepreneurs:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/:challengeId/leaderboard
     * Gets the real-time leaderboard.
     */
    async getLeaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const leaderboard = await entrepreneurService.getLeaderboard(challengeId);

            res.status(200).json({ success: true, data: leaderboard });
        } catch (error: any) {
            log.error('Error getting leaderboard:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/entrepreneurs/:entrepreneurId
     * Gets entrepreneur details.
     */
    async getEntrepreneurById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { entrepreneurId } = req.params;
            const entrepreneur = await entrepreneurService.getEntrepreneurById(entrepreneurId);

            if (!entrepreneur) {
                res.status(404).json({ success: false, message: 'Entrepreneur not found' });
                return;
            }

            res.status(200).json({ success: true, data: entrepreneur });
        } catch (error: any) {
            log.error('Error getting entrepreneur:', error.message);
            next(error);
        }
    }

    // ================== VOTING ENDPOINTS ==================

    /**
     * POST /api/challenges/:challengeId/vote
     * Initiates a vote (members only, generates lottery tickets).
     */
    async initiateVote(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ success: false, message: 'Authentication required to vote' });
            return;
        }

        try {
            const { challengeId } = req.params;
            const { entrepreneurId, amount } = req.body;

            if (!entrepreneurId || !amount) {
                res.status(400).json({ success: false, message: 'entrepreneurId and amount are required' });
                return;
            }

            const result = await challengeVoteService.initiateVote(
                userId,
                challengeId,
                entrepreneurId,
                Number(amount)
            );

            res.status(200).json({
                success: true,
                message: 'Vote initiated successfully',
                data: result
            });
        } catch (error: any) {
            log.error('Error initiating vote:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * POST /api/challenges/:challengeId/support
     * Initiates support (public, no lottery tickets).
     */
    async initiateSupport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const {
                entrepreneurId,
                amount,
                supporterName,
                supporterEmail,
                supporterPhone,
                supportMessage,
                isAnonymous
            } = req.body;

            if (!entrepreneurId || !amount) {
                res.status(400).json({ success: false, message: 'entrepreneurId and amount are required' });
                return;
            }

            const result = await challengeVoteService.initiateSupport({
                challengeId,
                entrepreneurId,
                amount: Number(amount),
                userId: req.user?.userId,
                supporterName,
                supporterEmail,
                supporterPhone,
                supportMessage,
                isAnonymous: isAnonymous || false
            });

            res.status(200).json({
                success: true,
                message: 'Support initiated successfully',
                data: result
            });
        } catch (error: any) {
            log.error('Error initiating support:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/challenges/:challengeId/ticket-allowance
     * Gets user's remaining ticket allowance.
     */
    async getTicketAllowance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        try {
            const { challengeId } = req.params;
            const allowance = await challengeVoteService.getUserTicketAllowance(userId, challengeId);

            res.status(200).json({ success: true, data: allowance });
        } catch (error: any) {
            log.error('Error getting ticket allowance:', error.message);
            next(error);
        }
    }

    // ================== WEBHOOK ==================

    /**
     * POST /api/challenges/webhooks/payment-confirmation
     * Handles payment confirmation webhook.
     */
    async handlePaymentWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Received challenge payment webhook');

        const { sessionId, status, metadata } = req.body;
        log.debug('Webhook payload:', { sessionId, status, metadata });

        if (status === 'SUCCEEDED') {
            if (!sessionId) {
                log.error('Webhook failed: Missing session ID');
                res.status(400).json({ success: false, message: 'Missing session ID' });
                return;
            }

            try {
                await challengeVoteService.confirmPayment(sessionId, metadata);
                res.status(200).json({ success: true, message: 'Webhook processed' });
            } catch (error: any) {
                log.error(`Error processing webhook for session ${sessionId}:`, error.message);
                const statusCode = error instanceof AppError ? error.statusCode : 500;
                res.status(statusCode).json({ success: false, message: error.message });
            }
        } else {
            log.info(`Non-successful payment status: ${status}`);
            res.status(200).json({ success: true, message: 'Webhook acknowledged' });
        }
    }

    // ================== ADMIN ENDPOINTS ==================

    /**
     * POST /api/challenges/admin
     * Creates a new challenge.
     */
    async createChallenge(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { campaignName, month, year, startDate, endDate, description } = req.body;

            if (!campaignName || !month || !year || !startDate || !endDate || !description) {
                res.status(400).json({ success: false, message: 'Missing required fields' });
                return;
            }

            const challenge = await impactChallengeService.createChallenge({
                campaignName,
                month: Number(month),
                year: Number(year),
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                description
            });

            res.status(201).json({
                success: true,
                message: 'Challenge created successfully',
                data: challenge
            });
        } catch (error: any) {
            log.error('Error creating challenge:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/challenges/admin
     * Lists all challenges with pagination.
     */
    async listChallenges(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const status = req.query.status as ChallengeStatus | undefined;

            const result = await impactChallengeService.listChallenges(page, limit, status);

            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            log.error('Error listing challenges:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/admin/:challengeId
     * Gets challenge details for admin.
     */
    async getAdminChallengeDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const challenge = await impactChallengeService.getChallengeById(challengeId);

            if (!challenge) {
                res.status(404).json({ success: false, message: 'Challenge not found' });
                return;
            }

            // Get all entrepreneurs (not just approved)
            const entrepreneurs = await entrepreneurService.listEntrepreneursByChallenge(challengeId, false);

            res.status(200).json({
                success: true,
                data: {
                    challenge,
                    entrepreneurs
                }
            });
        } catch (error: any) {
            log.error('Error getting admin challenge details:', error.message);
            next(error);
        }
    }

    /**
     * PATCH /api/challenges/admin/:challengeId
     * Updates challenge details.
     */
    async updateChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const update = req.body;

            const challenge = await impactChallengeService.updateChallenge(challengeId, update);

            if (!challenge) {
                res.status(404).json({ success: false, message: 'Challenge not found' });
                return;
            }

            res.status(200).json({ success: true, data: challenge });
        } catch (error: any) {
            log.error('Error updating challenge:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * PATCH /api/challenges/admin/:challengeId/status
     * Updates challenge status.
     */
    async updateChallengeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const { status } = req.body;

            if (!status || !Object.values(ChallengeStatus).includes(status)) {
                res.status(400).json({ success: false, message: 'Invalid status' });
                return;
            }

            const challenge = await impactChallengeService.updateStatus(challengeId, status);

            res.status(200).json({ success: true, data: challenge });
        } catch (error: any) {
            log.error('Error updating challenge status:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * DELETE /api/challenges/admin/:challengeId
     * Deletes a challenge.
     */
    async deleteChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            await impactChallengeService.deleteChallenge(challengeId);

            res.status(200).json({ success: true, message: 'Challenge deleted successfully' });
        } catch (error: any) {
            log.error('Error deleting challenge:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    // ================== ENTREPRENEUR ADMIN ENDPOINTS ==================

    /**
     * POST /api/challenges/admin/:challengeId/entrepreneurs
     * Adds an entrepreneur to a challenge.
     */
    async addEntrepreneur(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const entrepreneurData = req.body;

            const entrepreneur = await entrepreneurService.addEntrepreneur(challengeId, entrepreneurData);

            res.status(201).json({
                success: true,
                message: 'Entrepreneur added successfully',
                data: entrepreneur
            });
        } catch (error: any) {
            log.error('Error adding entrepreneur:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * PATCH /api/challenges/admin/entrepreneurs/:entrepreneurId
     * Updates an entrepreneur.
     */
    async updateEntrepreneur(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { entrepreneurId } = req.params;
            const update = req.body;

            const entrepreneur = await entrepreneurService.updateEntrepreneur(entrepreneurId, update);

            if (!entrepreneur) {
                res.status(404).json({ success: false, message: 'Entrepreneur not found' });
                return;
            }

            res.status(200).json({ success: true, data: entrepreneur });
        } catch (error: any) {
            log.error('Error updating entrepreneur:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * PATCH /api/challenges/admin/entrepreneurs/:entrepreneurId/approve
     * Approves an entrepreneur.
     */
    async approveEntrepreneur(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { entrepreneurId } = req.params;
            const adminUserId = req.user?.userId || 'unknown';

            const entrepreneur = await entrepreneurService.approveEntrepreneur(entrepreneurId, adminUserId);

            res.status(200).json({
                success: true,
                message: 'Entrepreneur approved successfully',
                data: entrepreneur
            });
        } catch (error: any) {
            log.error('Error approving entrepreneur:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * DELETE /api/challenges/admin/entrepreneurs/:entrepreneurId
     * Deletes an entrepreneur.
     */
    async deleteEntrepreneur(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { entrepreneurId } = req.params;
            await entrepreneurService.deleteEntrepreneur(entrepreneurId);

            res.status(200).json({ success: true, message: 'Entrepreneur deleted successfully' });
        } catch (error: any) {
            log.error('Error deleting entrepreneur:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    // ================== FUND DISTRIBUTION ==================

    /**
     * POST /api/challenges/admin/:challengeId/close-voting
     * Closes voting and calculates winner.
     */
    async closeVoting(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const challenge = await impactChallengeService.closeVoting(challengeId);

            res.status(200).json({
                success: true,
                message: 'Voting closed successfully',
                data: challenge
            });
        } catch (error: any) {
            log.error('Error closing voting:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/challenges/admin/:challengeId/fund-summary
     * Gets fund distribution preview.
     */
    async getFundSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const summary = await impactChallengeService.getFundSummary(challengeId);

            res.status(200).json({ success: true, data: summary });
        } catch (error: any) {
            log.error('Error getting fund summary:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * POST /api/challenges/admin/:challengeId/distribute-funds
     * Distributes funds (50% winner, 30% lottery, 20% commission).
     */
    async distributeFunds(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const result = await impactChallengeService.distributeFunds(challengeId);

            res.status(200).json({
                success: true,
                message: 'Funds distributed successfully',
                data: result
            });
        } catch (error: any) {
            log.error('Error distributing funds:', error.message);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/challenges/admin/:challengeId/analytics
     * Gets challenge analytics.
     */
    async getChallengeAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const analytics = await impactChallengeService.getChallengeAnalytics(challengeId);

            res.status(200).json({ success: true, data: analytics });
        } catch (error: any) {
            log.error('Error getting analytics:', error.message);
            next(error);
        }
    }

    /**
     * GET /api/challenges/admin/:challengeId/votes
     * Gets votes for a challenge.
     */
    async getVotes(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { challengeId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await challengeVoteService.getVotesByChallenge(challengeId, page, limit);

            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            log.error('Error getting votes:', error.message);
            next(error);
        }
    }
}

// Export singleton instance
export const impactChallengeController = new ImpactChallengeController();
