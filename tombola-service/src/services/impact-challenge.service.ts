import { Types } from 'mongoose';
import { impactChallengeRepository } from '../database/repositories/impact-challenge.repository';
import { entrepreneurRepository } from '../database/repositories/entrepreneur.repository';
import { tombolaMonthRepository } from '../database/repositories/tombolaMonth.repository';
import ImpactChallengeModel, { IImpactChallenge, ChallengeStatus } from '../database/models/impact-challenge.model';
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

        // Only what a status change alone may do. Closing voting must rank the
        // entrepreneurs (closeVoting) and "funds distributed" must pay them
        // (distributeFunds); setting either status by hand skipped that work.
        const validTransitions: Record<ChallengeStatus, ChallengeStatus[]> = {
            [ChallengeStatus.DRAFT]: [ChallengeStatus.ACTIVE, ChallengeStatus.CANCELLED],
            [ChallengeStatus.ACTIVE]: [ChallengeStatus.CANCELLED],
            [ChallengeStatus.VOTING_CLOSED]: [ChallengeStatus.CANCELLED],
            [ChallengeStatus.FUNDS_DISTRIBUTED]: [],
            [ChallengeStatus.CANCELLED]: []
        };

        if (!validTransitions[challenge.status].includes(newStatus)) {
            const hint = newStatus === ChallengeStatus.VOTING_CLOSED ? ' Use close-voting.'
                : newStatus === ChallengeStatus.FUNDS_DISTRIBUTED ? ' Use distribute-funds.' : '';
            throw new AppError(`Cannot transition from ${challenge.status} to ${newStatus}.${hint}`, 400);
        }

        // Members paid for these votes; there is no refund path, so a challenge
        // that collected money is paid out, not cancelled.
        if (newStatus === ChallengeStatus.CANCELLED && (challenge.totalCollected ?? 0) > 0) {
            throw new AppError('Cannot cancel a challenge that has collected money; close voting and distribute instead', 400);
        }

        if (newStatus === ChallengeStatus.ACTIVE) {
            const approved = (await entrepreneurRepository.findLeaderboardByChallenge(id)).filter(e => e.approved);
            if (!approved.length) throw new AppError('Approve at least one entrepreneur before activating', 400);
            const otherActive = await impactChallengeRepository.findCurrentActive();
            if (otherActive && otherActive._id.toString() !== id) {
                throw new AppError(`Another challenge is already active (${otherActive.campaignName})`, 400);
            }
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

        // Stop new votes first, atomically: a manual close and the auto-close
        // cannot both run, and no vote is counted after the ranking below.
        const claimedClose = await ImpactChallengeModel.findOneAndUpdate(
            { _id: challengeId, status: ChallengeStatus.ACTIVE },
            { $set: { status: ChallengeStatus.VOTING_CLOSED } },
            { new: true },
        );
        if (!claimedClose) throw new AppError('Voting is already closed for this challenge', 400);

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
     *
     * Real money, three deposits. The challenge is claimed first
     * (distributionInProgress) so two clicks cannot both pay; the amounts are
     * fixed at the first attempt; each deposit's transaction id is saved the
     * moment it succeeds, so a retry after a failure pays only the legs still
     * unpaid. Before, a failure on the 2nd or 3rd deposit left the challenge
     * VOTING_CLOSED and a retry paid the winner again.
     */
    async distributeFunds(challengeId: string): Promise<FundDistributionResult> {
        log.info(`Starting fund distribution for challenge ${challengeId}`);

        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) throw new AppError('Challenge not found', 404);
        if (challenge.fundsDistributed) throw new AppError('Funds have already been distributed for this challenge', 400);
        if (challenge.status !== ChallengeStatus.VOTING_CLOSED) {
            throw new AppError(`Cannot distribute funds: challenge status is ${challenge.status}`, 400);
        }
        if (!config.impactChallenge.lotteryPoolAccountId || !config.impactChallenge.sbcCommissionAccountId) {
            throw new AppError('Fund distribution account IDs not configured (LOTTERY_POOL_ACCOUNT_ID, SBC_COMMISSION_ACCOUNT_ID)', 500);
        }
        const winner = await entrepreneurRepository.findOne({ challengeId: new Types.ObjectId(challengeId), isWinner: true });
        if (!winner || !winner.userId) {
            throw new AppError('Winner entrepreneur must have a linked user account to receive funds', 400);
        }

        // Claim. The amounts are computed once and stored with the claim.
        const winnerPayout = challenge.winnerPayoutAmount ?? Math.floor(challenge.totalCollected * WINNER_PERCENTAGE);
        const lotteryPool = challenge.lotteryPoolAmount ?? Math.floor(challenge.totalCollected * LOTTERY_PERCENTAGE);
        const commission = challenge.commissionAmount
            ?? challenge.totalCollected - winnerPayout - lotteryPool; // rounding remainder goes to commission
        const claimed = await ImpactChallengeModel.findOneAndUpdate(
            { _id: challengeId, status: ChallengeStatus.VOTING_CLOSED, fundsDistributed: false, distributionInProgress: { $ne: true } },
            { $set: { distributionInProgress: true, winnerPayoutAmount: winnerPayout, lotteryPoolAmount: lotteryPool, commissionAmount: commission } },
            { new: true },
        );
        if (!claimed) throw new AppError('A distribution is already running for this challenge', 409);

        const legs: Array<{ key: 'winnerTransactionId' | 'lotteryTransactionId' | 'commissionTransactionId'; userId: string; amount: number; description: string; type: string }> = [
            { key: 'winnerTransactionId', userId: winner.userId.toString(), amount: winnerPayout, description: `Impact Challenge Winner Payout - ${challenge.campaignName}`, type: 'challenge_winner_payout' },
            { key: 'lotteryTransactionId', userId: config.impactChallenge.lotteryPoolAccountId, amount: lotteryPool, description: `Impact Challenge Lottery Pool - ${challenge.campaignName}`, type: 'challenge_lottery_pool' },
            { key: 'commissionTransactionId', userId: config.impactChallenge.sbcCommissionAccountId, amount: commission, description: `Impact Challenge Commission - ${challenge.campaignName}`, type: 'challenge_commission' },
        ];

        try {
            for (const leg of legs) {
                if (claimed[leg.key]) continue; // paid on an earlier attempt
                if (leg.amount <= 0) continue;
                log.info(`Distributing ${leg.amount} XAF (${leg.type}) to ${leg.userId}`);
                const tx = await paymentService.recordInternalDeposit({
                    userId: leg.userId,
                    amount: leg.amount,
                    description: leg.description,
                    metadata: { challengeId, entrepreneurId: winner._id.toString(), tombolaMonthId: challenge.tombolaMonthId.toString(), type: leg.type },
                });
                await ImpactChallengeModel.updateOne({ _id: challengeId }, { $set: { [leg.key]: tx.transactionId } });
                claimed.set(leg.key, tx.transactionId);
            }
        } catch (error: any) {
            await ImpactChallengeModel.updateOne({ _id: challengeId }, { $set: { distributionInProgress: false } });
            log.error(`Fund distribution for challenge ${challengeId} stopped: ${error.message}. Paid legs are recorded; retrying pays only the rest.`);
            throw new AppError('Fund distribution stopped part-way. Already-paid parts are recorded; retry to pay the rest.', 500);
        }

        await ImpactChallengeModel.updateOne(
            { _id: challengeId },
            { $set: { fundsDistributed: true, distributionInProgress: false, distributionDate: new Date(), status: ChallengeStatus.FUNDS_DISTRIBUTED } },
        );
        log.info(`Successfully distributed funds for challenge ${challengeId}`);
        const done = (await impactChallengeRepository.findById(challengeId))!;
        return {
            success: true,
            distribution: { winnerPayout, lotteryPool, commission },
            transactionIds: {
                winner: done.winnerTransactionId ?? '',
                lottery: done.lotteryTransactionId ?? '',
                commission: done.commissionTransactionId ?? '',
            },
        };
    }

    /**
     * Closes voting on challenges whose end date has passed (an hour of grace
     * for payments already on their way). Nothing used to close a challenge but
     * an admin, so votes kept being taken after the end date.
     */
    async closeEndedChallenges(now: Date = new Date(), graceMs = 60 * 60 * 1000): Promise<number> {
        const ended = await ImpactChallengeModel.find({ status: ChallengeStatus.ACTIVE, endDate: { $lt: new Date(now.getTime() - graceMs) } });
        let closed = 0;
        for (const c of ended) {
            try {
                await this.closeVoting(c._id.toString());
                closed++;
            } catch (err: any) {
                log.error(`Auto-close of challenge ${c._id} failed: ${err.message}`);
            }
        }
        if (closed) log.info(`Auto-closed voting on ${closed} challenge(s) past their end date`);
        return closed;
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
