import { Types } from 'mongoose';
import { interestRepository } from '../database/repositories/interest.repository';
import { interestQuotaRepository } from '../database/repositories/interest-quota.repository';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { blockRepository } from '../database/repositories/block.repository';
import { matchRepository } from '../database/repositories/match.repository';
import { ProfileStatus } from '../types/sbclove.enums';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { sbcloveNotificationService } from './notification.service';
import { getSessionDateKey } from '../utils/sbcloveWindow';
import { AppError } from '../utils/errors';

class InterestService {

    /**
     * Expresses interest from `fromUserId` toward the owner of `targetProfileId`
     * (spec §9). Enforces the weekly quota, self/block rules, and creates a match
     * on reciprocity (spec §10).
     */
    async expressInterest(fromUserId: string, targetProfileId: string): Promise<{ matched: boolean; matchId?: string; interestsLeft: number }> {
        // The expresser must have an approved profile so any resulting match is
        // well-formed (both sides have a browsable card). Spec §2: members without
        // a profile only get limited (read) access.
        const myProfile = await loveProfileRepository.findByUserId(fromUserId);
        if (!myProfile || myProfile.status !== ProfileStatus.APPROVED) {
            throw new AppError('You need an approved SBCLOVE profile to express interest.', 403);
        }

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

        const moduleCfg = await moduleConfigRepository.get();
        const sessionDate = getSessionDateKey(new Date(), moduleCfg);

        // Reject an already-expressed interest before consuming a quota slot.
        if (await interestRepository.exists(fromUserId, toUserId)) {
            throw new AppError('You have already expressed interest in this profile.', 409);
        }

        // Atomically reserve a weekly slot. Race-free under concurrency: the
        // conditional $inc can never push the count past the limit.
        const reserved = await interestQuotaRepository.tryReserve(fromUserId, sessionDate, moduleCfg.maxInterestsPerWeek);
        if (!reserved) {
            throw new AppError(`Weekly interest limit reached (${moduleCfg.maxInterestsPerWeek}).`, 429);
        }

        try {
            await interestRepository.create({
                fromUserId: new Types.ObjectId(fromUserId),
                toUserId: new Types.ObjectId(toUserId),
                sessionDate,
            });
        } catch (err) {
            // Insert failed (e.g. a concurrent duplicate) — give the reserved slot back.
            await interestQuotaRepository.release(fromUserId, sessionDate);
            throw err;
        }

        const interestsLeft = Math.max(0, moduleCfg.maxInterestsPerWeek - await interestQuotaRepository.getCount(fromUserId, sessionDate));

        // Reciprocity check → match (spec §10).
        const reciprocal = await interestRepository.exists(toUserId, fromUserId);
        if (!reciprocal) {
            return { matched: false, interestsLeft };
        }

        // Atomic get-or-create; only the call that actually created the match emails.
        const { match, created } = await matchRepository.createOrGet(fromUserId, toUserId);

        if (created) {
            // Notify both users (best-effort, never blocks the response).
            Promise.allSettled([
                sbcloveNotificationService.sendMatchEmail(fromUserId),
                sbcloveNotificationService.sendMatchEmail(toUserId),
            ]);
        }

        return { matched: true, matchId: match._id.toString(), interestsLeft };
    }

    async getSentInterests(userId: string, limit: number, skip: number) {
        return interestRepository.findSentByUser(userId, limit, skip);
    }

    async remainingInterests(userId: string): Promise<number> {
        const moduleCfg = await moduleConfigRepository.get();
        const used = await interestQuotaRepository.getCount(userId, getSessionDateKey(new Date(), moduleCfg));
        return Math.max(0, moduleCfg.maxInterestsPerWeek - used);
    }
}

export const interestService = new InterestService();
