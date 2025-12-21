import { Types } from 'mongoose';
import { impactChallengeRepository } from '../database/repositories/impact-challenge.repository';
import { entrepreneurRepository } from '../database/repositories/entrepreneur.repository';
import { tombolaMonthRepository } from '../database/repositories/tombolaMonth.repository';
import { IImpactChallenge, ChallengeStatus } from '../database/models/impact-challenge.model';
import { TombolaStatus } from '../database/models/tombolaMonth.model';
import { paymentService } from './clients/payment.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('ImpactChallengeService');

// Fund distribution percentages
const WINNER_PERCENTAGE = 0.50;
const LOTTERY_PERCENTAGE = 0.30;
const COMMISSION_PERCENTAGE = 0.20;

// Interface for create challenge payload
interface CreateChallengePayload {
    campaignName: string;
    month: number;
    year: number;
    startDate: Date;
    endDate: Date;
    description: { fr: string; en: string };
}

// Interface for fund distribution result
interface FundDistributionResult {
    success: boolean;
    distribution: {
        winnerPayout: number;
        lotteryPool: number;
        commission: number;
    };
    transactionIds: {
        winner: string;
        lottery: string;
        commission: string;
    };
}

// Interface for challenge analytics
interface ChallengeAnalytics {
    totalVotes: number;
    totalAmount: number;
    entrepreneurBreakdown: Array<{
        entrepreneurId: string;
        name: string;
        voteCount: number;
        totalAmount: number;
    }>;
}

class ImpactChallengeService {

    /**
     * Creates a new Impact Challenge with linked TombolaMonth.
     */
    async createChallenge(data: CreateChallengePayload): Promise<IImpactChallenge> {
        log.info(`Creating new Impact Challenge for ${data.year}-${data.month}`);

        // 1. Validate month/year uniqueness
        const existingChallenge = await impactChallengeRepository.findByMonthYear(data.month, data.year);
        if (existingChallenge) {
            throw new AppError(`Challenge already exists for ${data.year}-${data.month}`, 400);
        }

        // 2. Find or create TombolaMonth for same month/year
        let tombola = await tombolaMonthRepository.findByMonthYear(data.month, data.year);

        if (!tombola) {
            // Fetch previous month's winners for anti-consecutive-win rule
            const prevMonth = data.month === 1 ? 12 : data.month - 1;
            const prevYear = data.month === 1 ? data.year - 1 : data.year;
            const previousTombola = await tombolaMonthRepository.findByMonthYear(prevMonth, prevYear);
            const previousMonthWinners = previousTombola?.winners?.map(w => w.userId) || [];

            log.info(`Creating linked TombolaMonth for ${data.year}-${data.month} with ${previousMonthWinners.length} excluded winners`);

            // Create new TombolaMonth (omit winners - mongoose will initialize empty array)
            tombola = await tombolaMonthRepository.create({
                month: data.month,
                year: data.year,
                status: TombolaStatus.OPEN,
                startDate: data.startDate,
                endDate: data.endDate,
                previousMonthWinners: previousMonthWinners,
                lastTicketNumber: 0
            });
        }

        // 3. Create ImpactChallenge linked to tombola
        const challenge = await impactChallengeRepository.create({
            campaignName: data.campaignName,
            month: data.month,
            year: data.year,
            status: ChallengeStatus.DRAFT,
            startDate: data.startDate,
            endDate: data.endDate,
            description: data.description,
            tombolaMonthId: tombola._id,
            totalCollected: 0,
            totalVoteCount: 0,
            fundsDistributed: false
        });

        // 4. Link tombola to challenge
        await tombolaMonthRepository.findByIdAndUpdate(tombola._id, {
            linkedChallengeId: challenge._id
        });

        log.info(`Successfully created Impact Challenge ${challenge._id} linked to TombolaMonth ${tombola._id}`);
        return challenge;
    }

    /**
     * Gets the currently active challenge.
     */
    async getCurrentChallenge(): Promise<IImpactChallenge | null> {
        return await impactChallengeRepository.findCurrentActive();
    }

    /**
     * Gets challenge by ID.
     */
    async getChallengeById(id: string): Promise<IImpactChallenge | null> {
        return await impactChallengeRepository.findById(id);
    }

    /**
     * Lists all challenges with pagination.
     */
    async listChallenges(
        page: number = 1,
        limit: number = 10,
        status?: ChallengeStatus
    ): Promise<{ challenges: IImpactChallenge[]; total: number; page: number; limit: number }> {
        const skip = (page - 1) * limit;
        const query = status ? { status } : {};

        const [challenges, total] = await Promise.all([
            impactChallengeRepository.find(query, limit, skip),
            impactChallengeRepository.count(query)
        ]);

        return { challenges, total, page, limit };
    }

    /**
     * Updates challenge details.
     */
    async updateChallenge(id: string, update: Partial<IImpactChallenge>): Promise<IImpactChallenge | null> {
        const challenge = await impactChallengeRepository.findById(id);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        // Don't allow updating certain fields once active
        if (challenge.status !== ChallengeStatus.DRAFT) {
            delete update.month;
            delete update.year;
            delete update.tombolaMonthId;
        }

        return await impactChallengeRepository.findByIdAndUpdate(id, update);
    }

    /**
     * Updates challenge status.
     */
    async updateStatus(id: string, newStatus: ChallengeStatus): Promise<IImpactChallenge | null> {
        const challenge = await impactChallengeRepository.findById(id);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        // Validate status transitions
        const validTransitions: Record<ChallengeStatus, ChallengeStatus[]> = {
            [ChallengeStatus.DRAFT]: [ChallengeStatus.ACTIVE, ChallengeStatus.CANCELLED],
            [ChallengeStatus.ACTIVE]: [ChallengeStatus.VOTING_CLOSED, ChallengeStatus.CANCELLED],
            [ChallengeStatus.VOTING_CLOSED]: [ChallengeStatus.FUNDS_DISTRIBUTED, ChallengeStatus.CANCELLED],
            [ChallengeStatus.FUNDS_DISTRIBUTED]: [],
            [ChallengeStatus.CANCELLED]: []
        };

        if (!validTransitions[challenge.status].includes(newStatus)) {
            throw new AppError(`Cannot transition from ${challenge.status} to ${newStatus}`, 400);
        }

        return await impactChallengeRepository.findByIdAndUpdate(id, { status: newStatus });
    }

    /**
     * Closes voting and calculates the winner.
     */
    async closeVoting(challengeId: string): Promise<IImpactChallenge> {
        log.info(`Closing voting for challenge ${challengeId}`);

        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        if (challenge.status !== ChallengeStatus.ACTIVE) {
            throw new AppError(`Cannot close voting: challenge status is ${challenge.status}`, 400);
        }

        // Get all entrepreneurs sorted by vote count
        const entrepreneurs = await entrepreneurRepository.findLeaderboardByChallenge(challengeId);

        // Assign ranks
        for (let i = 0; i < entrepreneurs.length; i++) {
            const rank = i + 1;
            await entrepreneurRepository.findByIdAndUpdate(entrepreneurs[i]._id, {
                rank,
                isWinner: rank === 1
            });
        }

        // Update challenge status
        const updatedChallenge = await impactChallengeRepository.findByIdAndUpdate(challengeId, {
            status: ChallengeStatus.VOTING_CLOSED
        });

        if (!updatedChallenge) {
            throw new AppError('Failed to update challenge status', 500);
        }

        log.info(`Voting closed for challenge ${challengeId}. Winner: ${entrepreneurs[0]?.name || 'N/A'}`);
        return updatedChallenge;
    }

    /**
     * Gets fund distribution preview.
     */
    async getFundSummary(challengeId: string): Promise<{
        totalCollected: number;
        winnerPayout: number;
        lotteryPool: number;
        commission: number;
        winner: { name: string; projectName: string; userId?: string } | null;
    }> {
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        const winnerPayout = Math.floor(challenge.totalCollected * WINNER_PERCENTAGE);
        const lotteryPool = Math.floor(challenge.totalCollected * LOTTERY_PERCENTAGE);
        const commission = Math.floor(challenge.totalCollected * COMMISSION_PERCENTAGE);
        const remainder = challenge.totalCollected - (winnerPayout + lotteryPool + commission);

        // Get winner entrepreneur
        const winner = await entrepreneurRepository.findOne({
            challengeId: new Types.ObjectId(challengeId),
            isWinner: true
        });

        return {
            totalCollected: challenge.totalCollected,
            winnerPayout,
            lotteryPool,
            commission: commission + remainder, // Add rounding remainder to commission
            winner: winner ? {
                name: winner.name,
                projectName: winner.projectName,
                userId: winner.userId?.toString()
            } : null
        };
    }

    /**
     * Distributes funds (50% to winner, 30% to lottery pool, 20% to commission).
     */
    async distributeFunds(challengeId: string): Promise<FundDistributionResult> {
        log.info(`Starting fund distribution for challenge ${challengeId}`);

        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        if (challenge.status !== ChallengeStatus.VOTING_CLOSED) {
            throw new AppError(`Cannot distribute funds: challenge status is ${challenge.status}`, 400);
        }

        if (challenge.fundsDistributed) {
            throw new AppError('Funds have already been distributed for this challenge', 400);
        }

        // Get winner entrepreneur
        const winner = await entrepreneurRepository.findOne({
            challengeId: new Types.ObjectId(challengeId),
            isWinner: true
        });

        if (!winner || !winner.userId) {
            throw new AppError('Winner entrepreneur must have a linked user account to receive funds', 400);
        }

        // Calculate distribution
        const winnerPayout = Math.floor(challenge.totalCollected * WINNER_PERCENTAGE);
        const lotteryPool = Math.floor(challenge.totalCollected * LOTTERY_PERCENTAGE);
        const commission = Math.floor(challenge.totalCollected * COMMISSION_PERCENTAGE);
        const remainder = challenge.totalCollected - (winnerPayout + lotteryPool + commission);

        const distribution = {
            winnerPayout,
            lotteryPool,
            commission: commission + remainder
        };

        // Validate configuration
        if (!config.impactChallenge.lotteryPoolAccountId || !config.impactChallenge.sbcCommissionAccountId) {
            throw new AppError('Fund distribution account IDs not configured', 500);
        }

        try {
            // Execute deposits via payment-service
            log.info(`Distributing ${distribution.winnerPayout} CFA to winner ${winner.userId}`);
            const winnerTx = await paymentService.recordInternalDeposit({
                userId: winner.userId.toString(),
                amount: distribution.winnerPayout,
                description: `Impact Challenge Winner Payout - ${challenge.campaignName}`,
                metadata: {
                    challengeId: challengeId,
                    entrepreneurId: winner._id.toString(),
                    type: 'challenge_winner_payout'
                }
            });

            log.info(`Transferring ${distribution.lotteryPool} CFA to lottery pool`);
            const lotteryTx = await paymentService.recordInternalDeposit({
                userId: config.impactChallenge.lotteryPoolAccountId,
                amount: distribution.lotteryPool,
                description: `Impact Challenge Lottery Pool - ${challenge.campaignName}`,
                metadata: {
                    challengeId: challengeId,
                    tombolaMonthId: challenge.tombolaMonthId.toString(),
                    type: 'challenge_lottery_pool'
                }
            });

            log.info(`Transferring ${distribution.commission} CFA to SBC commission`);
            const commissionTx = await paymentService.recordInternalDeposit({
                userId: config.impactChallenge.sbcCommissionAccountId,
                amount: distribution.commission,
                description: `Impact Challenge Commission - ${challenge.campaignName}`,
                metadata: {
                    challengeId: challengeId,
                    type: 'challenge_commission'
                }
            });

            // Update challenge with distribution details
            await impactChallengeRepository.findByIdAndUpdate(challengeId, {
                fundsDistributed: true,
                distributionDate: new Date(),
                winnerPayoutAmount: distribution.winnerPayout,
                lotteryPoolAmount: distribution.lotteryPool,
                commissionAmount: distribution.commission,
                winnerTransactionId: winnerTx.transactionId,
                lotteryTransactionId: lotteryTx.transactionId,
                commissionTransactionId: commissionTx.transactionId,
                status: ChallengeStatus.FUNDS_DISTRIBUTED
            });

            log.info(`Successfully distributed funds for challenge ${challengeId}`);

            return {
                success: true,
                distribution,
                transactionIds: {
                    winner: winnerTx.transactionId,
                    lottery: lotteryTx.transactionId,
                    commission: commissionTx.transactionId
                }
            };

        } catch (error: any) {
            log.error(`Fund distribution failed for challenge ${challengeId}: ${error.message}`);
            throw new AppError('Fund distribution failed. Manual intervention required.', 500);
        }
    }

    /**
     * Gets challenge analytics.
     */
    async getChallengeAnalytics(challengeId: string): Promise<ChallengeAnalytics> {
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        const entrepreneurs = await entrepreneurRepository.findLeaderboardByChallenge(challengeId);

        return {
            totalVotes: challenge.totalVoteCount,
            totalAmount: challenge.totalCollected,
            entrepreneurBreakdown: entrepreneurs.map(e => ({
                entrepreneurId: e._id.toString(),
                name: e.name,
                voteCount: e.voteCount,
                totalAmount: e.totalAmount
            }))
        };
    }

    /**
     * Deletes a challenge (only if in DRAFT status and no votes).
     */
    async deleteChallenge(challengeId: string): Promise<void> {
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        if (challenge.status !== ChallengeStatus.DRAFT && challenge.status !== ChallengeStatus.CANCELLED) {
            throw new AppError('Can only delete challenges in DRAFT or CANCELLED status', 400);
        }

        if (challenge.totalVoteCount > 0) {
            throw new AppError('Cannot delete challenge with existing votes', 400);
        }

        await impactChallengeRepository.deleteById(challengeId);
        log.info(`Deleted challenge ${challengeId}`);
    }
}

// Export singleton instance
export const impactChallengeService = new ImpactChallengeService();
