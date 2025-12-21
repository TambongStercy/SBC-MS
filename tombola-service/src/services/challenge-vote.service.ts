import { Types } from 'mongoose';
import { nanoid } from 'nanoid';
import { challengeVoteRepository } from '../database/repositories/challenge-vote.repository';
import { impactChallengeRepository } from '../database/repositories/impact-challenge.repository';
import { entrepreneurRepository } from '../database/repositories/entrepreneur.repository';
import { tombolaTicketRepository } from '../database/repositories/tombolaTicket.repository';
import { tombolaMonthRepository } from '../database/repositories/tombolaMonth.repository';
import { IChallengeVote, VotePaymentStatus, VoteType } from '../database/models/challenge-vote.model';
import { ChallengeStatus } from '../database/models/impact-challenge.model';
import { paymentService } from './clients/payment.service.client';
import { entrepreneurService } from './entrepreneur.service';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('ChallengeVoteService');

// Interface for vote initiation response
interface VoteInitiationResponse {
    voteId: string;
    paymentSessionId: string;
    checkoutUrl?: string;
    voteQuantity: number;
    ticketQuantity: number;
    message?: string;
}

// Interface for support initiation payload
interface SupportPayload {
    challengeId: string;
    entrepreneurId: string;
    amount: number;
    userId?: string;
    supporterName?: string;
    supporterEmail?: string;
    supporterPhone?: string;
    supportMessage?: string;
    isAnonymous?: boolean;
}

class ChallengeVoteService {

    /**
     * Initiates a VOTE (members only, generates lottery tickets).
     */
    async initiateVote(
        userId: string,
        challengeId: string,
        entrepreneurId: string,
        amount: number
    ): Promise<VoteInitiationResponse> {
        log.info(`Initiating vote: user=${userId}, challenge=${challengeId}, entrepreneur=${entrepreneurId}, amount=${amount}`);

        // 1. Validate amount
        const votePrice = config.impactChallenge.votePrice;
        if (amount < votePrice || amount % votePrice !== 0) {
            throw new AppError(`Amount must be at least ${votePrice} and divisible by ${votePrice}`, 400);
        }

        const voteQuantity = amount / votePrice;

        // 2. Validate challenge is active
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }
        if (challenge.status !== ChallengeStatus.ACTIVE) {
            throw new AppError('Challenge is not currently accepting votes', 400);
        }

        // 3. Validate entrepreneur exists and is approved
        const entrepreneur = await entrepreneurRepository.findById(entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }
        if (!entrepreneur.approved) {
            throw new AppError('This entrepreneur is not yet approved for voting', 400);
        }
        if (entrepreneur.challengeId.toString() !== challengeId) {
            throw new AppError('Entrepreneur does not belong to this challenge', 400);
        }

        // 4. CHECK TICKET LIMIT (CRITICAL - 25 tickets max per user per month)
        const existingTicketCount = await tombolaTicketRepository.countByUserForMonth(
            userId,
            challenge.tombolaMonthId.toString()
        );

        const maxTickets = config.impactChallenge.maxTicketsPerUserPerMonth;
        const availableTickets = maxTickets - existingTicketCount;

        if (availableTickets <= 0) {
            throw new AppError(
                `You have reached the maximum ${maxTickets} lottery tickets for this month. Use the Support button to continue contributing.`,
                400
            );
        }

        // Calculate how many tickets can actually be generated
        const ticketsToGenerate = Math.min(voteQuantity, availableTickets);

        // If user is requesting more votes than available tickets, reject
        if (voteQuantity > availableTickets) {
            throw new AppError(
                `You can only vote ${availableTickets} more time(s) to reach the ${maxTickets} ticket limit. Use the Support button for additional contributions without tickets.`,
                400
            );
        }

        // 5. Create ChallengeVote record
        const vote = await challengeVoteRepository.create({
            challengeId: new Types.ObjectId(challengeId),
            entrepreneurId: new Types.ObjectId(entrepreneurId),
            userId: new Types.ObjectId(userId),
            amountPaid: amount,
            voteQuantity,
            voteType: VoteType.VOTE,
            paymentStatus: VotePaymentStatus.PENDING,
            isAnonymous: false,
            tombolaTicketIds: [],
            ticketsGenerated: false
        });

        // 6. Create PaymentIntent
        try {
            const paymentIntent = await paymentService.createIntent({
                userId,
                amount,
                currency: 'XAF',
                paymentType: 'CHALLENGE_VOTE',
                metadata: {
                    challengeId,
                    entrepreneurId,
                    userId,
                    voteId: vote._id.toString(),
                    voteType: VoteType.VOTE,
                    voteQuantity,
                    ticketsToGenerate,
                    originatingService: 'tombola-service',
                    callbackPath: `${config.selfBaseUrl}/api/challenges/webhooks/payment-confirmation`
                }
            });

            if (!paymentIntent || !paymentIntent.sessionId) {
                throw new AppError('Failed to create payment intent', 500);
            }

            // Update vote with payment intent ID
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                paymentIntentId: paymentIntent.sessionId
            });

            log.info(`Vote initiated: voteId=${vote._id}, sessionId=${paymentIntent.sessionId}, tickets=${ticketsToGenerate}`);

            return {
                voteId: vote._id.toString(),
                paymentSessionId: paymentIntent.sessionId,
                checkoutUrl: paymentIntent.paymentPageUrl,
                voteQuantity,
                ticketQuantity: ticketsToGenerate
            };

        } catch (error: any) {
            // Clean up vote record if payment intent fails
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                paymentStatus: VotePaymentStatus.FAILED
            });
            throw error;
        }
    }

    /**
     * Initiates a SUPPORT (anyone, no lottery tickets).
     */
    async initiateSupport(data: SupportPayload): Promise<VoteInitiationResponse> {
        log.info(`Initiating support: challenge=${data.challengeId}, entrepreneur=${data.entrepreneurId}, amount=${data.amount}`);

        // 1. Validate amount
        const votePrice = config.impactChallenge.votePrice;
        if (data.amount < votePrice || data.amount % votePrice !== 0) {
            throw new AppError(`Amount must be at least ${votePrice} and divisible by ${votePrice}`, 400);
        }

        const voteQuantity = data.amount / votePrice;

        // 2. Validate challenge is active
        const challenge = await impactChallengeRepository.findById(data.challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }
        if (challenge.status !== ChallengeStatus.ACTIVE) {
            throw new AppError('Challenge is not currently accepting support', 400);
        }

        // 3. Validate entrepreneur exists and is approved
        const entrepreneur = await entrepreneurRepository.findById(data.entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }
        if (!entrepreneur.approved) {
            throw new AppError('This entrepreneur is not yet approved', 400);
        }
        if (entrepreneur.challengeId.toString() !== data.challengeId) {
            throw new AppError('Entrepreneur does not belong to this challenge', 400);
        }

        // 4. Create ChallengeVote record (no ticket limit check - support has no tickets)
        const vote = await challengeVoteRepository.create({
            challengeId: new Types.ObjectId(data.challengeId),
            entrepreneurId: new Types.ObjectId(data.entrepreneurId),
            userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
            amountPaid: data.amount,
            voteQuantity,
            voteType: VoteType.SUPPORT,
            paymentStatus: VotePaymentStatus.PENDING,
            supporterName: data.supporterName,
            supporterEmail: data.supporterEmail,
            supporterPhone: data.supporterPhone,
            supportMessage: data.supportMessage,
            isAnonymous: data.isAnonymous || false,
            tombolaTicketIds: [], // No tickets for support
            ticketsGenerated: false // Will remain false for support
        });

        // 5. Create PaymentIntent
        try {
            const paymentIntent = await paymentService.createIntent({
                userId: data.userId || 'guest',
                amount: data.amount,
                currency: 'XAF',
                paymentType: 'CHALLENGE_SUPPORT',
                metadata: {
                    challengeId: data.challengeId,
                    entrepreneurId: data.entrepreneurId,
                    voteId: vote._id.toString(),
                    voteType: VoteType.SUPPORT,
                    voteQuantity,
                    ticketsToGenerate: 0, // NO tickets for support
                    supporterName: data.supporterName,
                    originatingService: 'tombola-service',
                    callbackPath: `${config.selfBaseUrl}/api/challenges/webhooks/payment-confirmation`
                }
            });

            if (!paymentIntent || !paymentIntent.sessionId) {
                throw new AppError('Failed to create payment intent', 500);
            }

            // Update vote with payment intent ID
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                paymentIntentId: paymentIntent.sessionId
            });

            log.info(`Support initiated: voteId=${vote._id}, sessionId=${paymentIntent.sessionId}, votes=${voteQuantity} (no tickets)`);

            return {
                voteId: vote._id.toString(),
                paymentSessionId: paymentIntent.sessionId,
                checkoutUrl: paymentIntent.paymentPageUrl,
                voteQuantity,
                ticketQuantity: 0 // NO tickets for support
            };

        } catch (error: any) {
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                paymentStatus: VotePaymentStatus.FAILED
            });
            throw error;
        }
    }

    /**
     * Confirms payment and processes votes/tickets (called by webhook).
     */
    async confirmPayment(paymentSessionId: string, metadata: any): Promise<void> {
        log.info(`Confirming payment for session: ${paymentSessionId}`);

        // 1. Find vote by payment intent ID
        const vote = await challengeVoteRepository.findOne({ paymentIntentId: paymentSessionId });
        if (!vote) {
            throw new AppError('Vote not found for payment session', 404);
        }

        // 2. Idempotency check
        if (vote.paymentStatus === VotePaymentStatus.COMPLETED) {
            log.info(`Vote ${vote._id} already processed (idempotency check)`);
            return;
        }

        // 3. Update vote status
        await challengeVoteRepository.updateStatus(vote._id, VotePaymentStatus.COMPLETED);

        // 4. Increment entrepreneur stats
        await entrepreneurService.incrementVotes(
            vote.entrepreneurId.toString(),
            vote.voteQuantity,
            vote.amountPaid
        );

        // 5. Increment challenge stats
        await impactChallengeRepository.findByIdAndUpdate(vote.challengeId, {
            $inc: {
                totalCollected: vote.amountPaid,
                totalVoteCount: vote.voteQuantity
            }
        });

        // 6. Generate lottery tickets ONLY if voteType = 'vote'
        if (vote.voteType === VoteType.VOTE && vote.userId) {
            await this.generateWeightedTickets(vote);
        } else {
            log.info(`Support payment confirmed (no tickets): ${vote.voteQuantity} votes for ${vote.amountPaid} CFA`);
        }

        log.info(`Payment confirmed for vote ${vote._id}: ${vote.voteQuantity} votes, ${vote.amountPaid} CFA`);
    }

    /**
     * Generates weighted lottery tickets for a vote.
     */
    private async generateWeightedTickets(vote: IChallengeVote): Promise<void> {
        const challenge = await impactChallengeRepository.findById(vote.challengeId.toString());
        if (!challenge) {
            log.error(`Challenge not found for vote ${vote._id}`);
            return;
        }

        const tombolaTicketIds: Types.ObjectId[] = [];

        try {
            // Get user's current ticket count for weight calculation
            const existingTicketCount = await tombolaTicketRepository.countByUserForMonth(
                vote.userId!.toString(),
                challenge.tombolaMonthId.toString()
            );

            const maxTickets = config.impactChallenge.maxTicketsPerUserPerMonth;
            const ticketsToGenerate = Math.min(vote.voteQuantity, maxTickets - existingTicketCount);

            log.info(`Generating ${ticketsToGenerate} weighted tickets for user ${vote.userId} (existing: ${existingTicketCount})`);

            for (let i = 0; i < ticketsToGenerate; i++) {
                const userTicketIndex = existingTicketCount + i + 1;

                // Calculate weight based on ticket index (diminishing returns)
                let weight: number;
                if (userTicketIndex <= 3) {
                    weight = 1.0; // Tickets 1-3: full weight
                } else if (userTicketIndex <= 15) {
                    weight = 0.6; // Tickets 4-15: 60% weight
                } else if (userTicketIndex <= 25) {
                    weight = 0.3; // Tickets 16-25: 30% weight
                } else {
                    break; // Should never reach here due to limit check
                }

                // Get sequential ticket number
                const ticketNumber = await tombolaMonthRepository.incrementAndGetTicketNumber(
                    challenge.tombolaMonthId.toString()
                );

                // Create ticket with weight
                const ticket = await tombolaTicketRepository.create({
                    userId: vote.userId,
                    tombolaMonthId: challenge.tombolaMonthId,
                    ticketId: nanoid(12),
                    ticketNumber,
                    purchaseTimestamp: new Date(),
                    paymentIntentId: vote.paymentIntentId,
                    weight, // NEW: weighted probability
                    userTicketIndex, // NEW: user's Nth ticket
                    sourceType: 'challenge_vote', // NEW: source tracking
                    challengeVoteId: vote._id // NEW: link to vote
                });

                tombolaTicketIds.push(ticket._id);

                log.debug(`Created ticket ${ticketNumber} for user ${vote.userId} with weight ${weight} (index ${userTicketIndex})`);
            }

            // Update vote with generated ticket IDs
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                tombolaTicketIds,
                ticketsGenerated: true
            });

            log.info(`Generated ${tombolaTicketIds.length} weighted lottery tickets for vote ${vote._id}`);

        } catch (error: any) {
            log.error(`Ticket generation failed for vote ${vote._id}: ${error.message}`);
            await challengeVoteRepository.findByIdAndUpdate(vote._id, {
                ticketGenerationError: error.message
            });
        }
    }

    /**
     * Gets votes for a challenge with pagination.
     */
    async getVotesByChallenge(
        challengeId: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ votes: IChallengeVote[]; total: number }> {
        const skip = (page - 1) * limit;
        const query = {
            challengeId: new Types.ObjectId(challengeId),
            paymentStatus: VotePaymentStatus.COMPLETED
        };

        const [votes, total] = await Promise.all([
            challengeVoteRepository.find(query, limit, skip),
            challengeVoteRepository.count(query)
        ]);

        return { votes, total };
    }

    /**
     * Gets a user's votes for a challenge.
     */
    async getUserVotesForChallenge(userId: string, challengeId: string): Promise<IChallengeVote[]> {
        return await challengeVoteRepository.find({
            userId: new Types.ObjectId(userId),
            challengeId: new Types.ObjectId(challengeId),
            paymentStatus: VotePaymentStatus.COMPLETED
        });
    }

    /**
     * Gets a user's remaining ticket allowance for the month.
     */
    async getUserTicketAllowance(userId: string, challengeId: string): Promise<{
        used: number;
        remaining: number;
        max: number;
    }> {
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        const used = await tombolaTicketRepository.countByUserForMonth(
            userId,
            challenge.tombolaMonthId.toString()
        );

        const max = config.impactChallenge.maxTicketsPerUserPerMonth;

        return {
            used,
            remaining: Math.max(0, max - used),
            max
        };
    }
}

// Export singleton instance
export const challengeVoteService = new ChallengeVoteService();
