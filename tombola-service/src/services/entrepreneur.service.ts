import { Types } from 'mongoose';
import { entrepreneurRepository } from '../database/repositories/entrepreneur.repository';
import { impactChallengeRepository } from '../database/repositories/impact-challenge.repository';
import { IEntrepreneur } from '../database/models/entrepreneur.model';
import { ChallengeStatus } from '../database/models/impact-challenge.model';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import config from '../config';

const log = logger.getLogger('EntrepreneurService');

// Interface for adding an entrepreneur
interface AddEntrepreneurPayload {
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    city: string;
    projectName: string;
    projectDescription: { fr: string; en: string };
    businessCategory: string;
    videoUrl: string;
    videoFilename: string;
    videoDuration?: number;
    videoThumbnailUrl?: string;
    userId?: string;
}

class EntrepreneurService {

    /**
     * Adds a new entrepreneur to a challenge.
     */
    async addEntrepreneur(challengeId: string, data: AddEntrepreneurPayload): Promise<IEntrepreneur> {
        log.info(`Adding entrepreneur "${data.name}" to challenge ${challengeId}`);

        // 1. Validate challenge exists and is in a valid state
        const challenge = await impactChallengeRepository.findById(challengeId);
        if (!challenge) {
            throw new AppError('Challenge not found', 404);
        }

        if (challenge.status !== ChallengeStatus.DRAFT && challenge.status !== ChallengeStatus.ACTIVE) {
            throw new AppError(`Cannot add entrepreneurs to challenge in ${challenge.status} status`, 400);
        }

        // 2. Check max entrepreneurs limit
        const existingCount = await entrepreneurRepository.count({ challengeId: new Types.ObjectId(challengeId) });
        if (existingCount >= config.impactChallenge.maxEntrepreneursPerChallenge) {
            throw new AppError(`Maximum ${config.impactChallenge.maxEntrepreneursPerChallenge} entrepreneurs allowed per challenge`, 400);
        }

        // 3. Validate video duration if provided
        if (data.videoDuration && data.videoDuration > config.impactChallenge.videoMaxDurationSeconds) {
            throw new AppError(`Video duration exceeds maximum of ${config.impactChallenge.videoMaxDurationSeconds} seconds`, 400);
        }

        // 4. Create entrepreneur record
        const entrepreneur = await entrepreneurRepository.create({
            challengeId: new Types.ObjectId(challengeId),
            userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
            name: data.name,
            email: data.email,
            phoneNumber: data.phoneNumber,
            country: data.country,
            city: data.city,
            projectName: data.projectName,
            projectDescription: data.projectDescription,
            businessCategory: data.businessCategory,
            videoUrl: data.videoUrl,
            videoFilename: data.videoFilename,
            videoDuration: data.videoDuration,
            videoThumbnailUrl: data.videoThumbnailUrl,
            voteCount: 0,
            totalAmount: 0,
            isWinner: false,
            approved: false
        });

        log.info(`Successfully added entrepreneur ${entrepreneur._id} to challenge ${challengeId}`);
        return entrepreneur;
    }

    /**
     * Gets entrepreneur by ID.
     */
    async getEntrepreneurById(id: string): Promise<IEntrepreneur | null> {
        return await entrepreneurRepository.findById(id);
    }

    /**
     * Lists entrepreneurs for a challenge.
     */
    async listEntrepreneursByChallenge(
        challengeId: string,
        approvedOnly: boolean = false
    ): Promise<IEntrepreneur[]> {
        const query: Record<string, any> = { challengeId: new Types.ObjectId(challengeId) };
        if (approvedOnly) {
            query.approved = true;
        }
        return await entrepreneurRepository.find(query, 10, 0, { voteCount: -1 });
    }

    /**
     * Gets the leaderboard for a challenge.
     */
    async getLeaderboard(challengeId: string): Promise<{
        entrepreneurs: Array<{
            _id: string;
            name: string;
            projectName: string;
            voteCount: number;
            totalAmount: number;
            rank: number;
            videoUrl: string;
            videoThumbnailUrl?: string;
        }>;
        lastUpdated: Date;
    }> {
        const entrepreneurs = await entrepreneurRepository.findLeaderboardByChallenge(challengeId, true);

        return {
            entrepreneurs: entrepreneurs.map((e, index) => ({
                _id: e._id.toString(),
                name: e.name,
                projectName: e.projectName,
                voteCount: e.voteCount,
                totalAmount: e.totalAmount,
                rank: index + 1,
                videoUrl: e.videoUrl,
                videoThumbnailUrl: e.videoThumbnailUrl
            })),
            lastUpdated: new Date()
        };
    }

    /**
     * Updates an entrepreneur.
     */
    async updateEntrepreneur(entrepreneurId: string, update: Partial<IEntrepreneur>): Promise<IEntrepreneur | null> {
        const entrepreneur = await entrepreneurRepository.findById(entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }

        // Never through an edit: votes, money, rank, winner, approval, challenge.
        const blocked = ['voteCount', 'totalAmount', 'rank', 'isWinner', 'approved', 'approvedBy', 'approvedAt', 'challengeId', '_id'] as const;
        const clean: Record<string, unknown> = { ...update };
        for (const k of blocked) delete clean[k];

        if (clean.videoDuration !== undefined && Number(clean.videoDuration) > config.impactChallenge.videoMaxDurationSeconds) {
            throw new AppError(`Video must be ${config.impactChallenge.videoMaxDurationSeconds} seconds or shorter`, 400);
        }

        // After voting closed only the linked SBC account may change (to pay the winner).
        const challenge = await impactChallengeRepository.findById(entrepreneur.challengeId.toString());
        if (challenge && challenge.status !== ChallengeStatus.DRAFT && challenge.status !== ChallengeStatus.ACTIVE) {
            for (const k of Object.keys(clean)) if (k !== 'userId') delete clean[k];
        }

        return await entrepreneurRepository.findByIdAndUpdate(entrepreneurId, clean as Partial<IEntrepreneur>);
    }

    /**
     * Approves an entrepreneur (makes them visible in the challenge).
     */
    async approveEntrepreneur(entrepreneurId: string, adminUserId: string): Promise<IEntrepreneur | null> {
        const entrepreneur = await entrepreneurRepository.findById(entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }

        if (entrepreneur.approved) {
            throw new AppError('Entrepreneur is already approved', 400);
        }

        const updated = await entrepreneurRepository.findByIdAndUpdate(entrepreneurId, {
            approved: true,
            approvedBy: new Types.ObjectId(adminUserId),
            approvedAt: new Date()
        });

        log.info(`Entrepreneur ${entrepreneurId} approved by admin ${adminUserId}`);
        return updated;
    }

    /**
     * Rejects/unapproves an entrepreneur.
     */
    async rejectEntrepreneur(entrepreneurId: string): Promise<IEntrepreneur | null> {
        const entrepreneur = await entrepreneurRepository.findById(entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }
        // Members may have paid to vote for them: hiding them would strand those votes.
        if ((entrepreneur.voteCount ?? 0) > 0) {
            throw new AppError('Cannot unapprove an entrepreneur who already has votes', 400);
        }

        return await entrepreneurRepository.findByIdAndUpdate(entrepreneurId, {
            approved: false,
            approvedBy: undefined,
            approvedAt: undefined
        });
    }

    /**
     * Deletes an entrepreneur (only if no votes).
     */
    async deleteEntrepreneur(entrepreneurId: string): Promise<void> {
        const entrepreneur = await entrepreneurRepository.findById(entrepreneurId);
        if (!entrepreneur) {
            throw new AppError('Entrepreneur not found', 404);
        }

        if (entrepreneur.voteCount > 0) {
            throw new AppError('Cannot delete entrepreneur with existing votes', 400);
        }

        await entrepreneurRepository.deleteById(entrepreneurId);
        log.info(`Deleted entrepreneur ${entrepreneurId}`);
    }

    /**
     * Increments vote counts for an entrepreneur (called after payment confirmation).
     */
    async incrementVotes(entrepreneurId: string, voteQuantity: number, amount: number): Promise<IEntrepreneur | null> {
        log.info(`Incrementing votes for entrepreneur ${entrepreneurId}: +${voteQuantity} votes, +${amount} CFA`);

        return await entrepreneurRepository.findByIdAndUpdate(entrepreneurId, {
            $inc: {
                voteCount: voteQuantity,
                totalAmount: amount
            }
        });
    }
}

// Export singleton instance
export const entrepreneurService = new EntrepreneurService();
