import { Types } from 'mongoose';
import { interestRepository } from '../database/repositories/interest.repository';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { blockRepository } from '../database/repositories/block.repository';
import { matchRepository } from '../database/repositories/match.repository';
import { ProfileStatus } from '../types/sbclove.enums';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { sbcloveNotificationService } from './notification.service';
import { getSessionDateKey } from '../utils/sbcloveWindow';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('InterestService');

class InterestService {

    /**
     * Expresses interest from `fromUserId` toward the owner of `targetProfileId`
     * (spec §9). Enforces the weekly quota, self/block rules, and creates a match
     * on reciprocity (spec §10).
     */
    async expressInterest(fromUserId: string, targetProfileId: string): Promise<{ matched: boolean; matchId?: string; interestsLeft: number }> {
        const target = await loveProfileRepository.findById(targetProfileId);
        if (!target || target.status !== ProfileStatus.APPROVED) {
            throw new AppError('Profile not found.', 404);
        }

        const toUserId = target.userId.toString();
        if (toUserId === fromUserId) {
            throw new AppError('You cannot express interest in your own profile.', 400);
        }

        if (await blockRepository.exists(fromUserId, toUserId) || await blockRepository.exists(toUserId, fromUserId)) {
            throw new AppError('Profile not found.', 404);
        }

        const sessionDate = getSessionDateKey();
        const moduleCfg = await moduleConfigRepository.get();

        const used = await interestRepository.countForSession(fromUserId, sessionDate);
        if (used >= moduleCfg.maxInterestsPerWeek) {
            throw new AppError(`Weekly interest limit reached (${moduleCfg.maxInterestsPerWeek}).`, 429);
        }

        if (await interestRepository.exists(fromUserId, toUserId)) {
            throw new AppError('You have already expressed interest in this profile.', 409);
        }

        await interestRepository.create({
            fromUserId: new Types.ObjectId(fromUserId),
            toUserId: new Types.ObjectId(toUserId),
            sessionDate,
        });

        const interestsLeft = Math.max(0, moduleCfg.maxInterestsPerWeek - (used + 1));

        // Reciprocity check → match (spec §10).
        const reciprocal = await interestRepository.exists(toUserId, fromUserId);
        if (!reciprocal) {
            return { matched: false, interestsLeft };
        }

        const existingMatch = await matchRepository.findByPair(fromUserId, toUserId);
        const match = existingMatch ?? await matchRepository.create(fromUserId, toUserId);

        if (!existingMatch) {
            // Notify both users (best-effort, never blocks the response).
            Promise.allSettled([
                sbcloveNotificationService.sendMatchEmail(fromUserId),
                sbcloveNotificationService.sendMatchEmail(toUserId),
            ]).catch(err => log.error('Match email dispatch error:', err));
        }

        return { matched: true, matchId: match._id.toString(), interestsLeft };
    }

    async getSentInterests(userId: string, limit: number, skip: number) {
        return interestRepository.findSentByUser(userId, limit, skip);
    }

    async remainingInterests(userId: string): Promise<number> {
        const moduleCfg = await moduleConfigRepository.get();
        const used = await interestRepository.countForSession(userId, getSessionDateKey());
        return Math.max(0, moduleCfg.maxInterestsPerWeek - used);
    }
}

export const interestService = new InterestService();
