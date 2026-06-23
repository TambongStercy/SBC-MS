import { Types } from 'mongoose';
import { reportRepository } from '../database/repositories/report.repository';
import { blockRepository } from '../database/repositories/block.repository';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { ProfileStatus } from '../types/sbclove.enums';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('ModerationService');

class ModerationService {

    /**
     * Files a report against a profile and auto-suspends it once the configured
     * threshold of distinct reports is reached (spec §14).
     */
    async reportProfile(reporterId: string, profileId: string, reason: string): Promise<{ reported: true; autoSuspended: boolean }> {
        if (!reason || reason.trim().length === 0) {
            throw new AppError('A reason is required to report a profile.', 400);
        }
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile) {
            throw new AppError('Profile not found.', 404);
        }
        if (profile.userId.toString() === reporterId) {
            throw new AppError('You cannot report your own profile.', 400);
        }

        await reportRepository.create({
            reporterId: new Types.ObjectId(reporterId),
            reportedUserId: profile.userId,
            reportedProfileId: new Types.ObjectId(profileId),
            reason: reason.trim(),
        });

        const updated = await loveProfileRepository.incrementReportCount(profileId);
        const reportCount = updated?.moderation.reportCount ?? 0;
        const threshold = (await moduleConfigRepository.get()).autoSuspendThreshold;

        let autoSuspended = false;
        if (reportCount >= threshold && updated?.status !== ProfileStatus.SUSPENDED) {
            await loveProfileRepository.setStatus(profileId, ProfileStatus.SUSPENDED, { suspendedAt: new Date() });
            autoSuspended = true;
            log.warn(`Profile ${profileId} auto-suspended after ${reportCount} reports (threshold ${threshold}).`);
        }

        return { reported: true, autoSuspended };
    }

    /** Blocks another user (spec §14). Mutual hiding is handled at browse time. */
    async blockProfile(blockerId: string, profileId: string): Promise<{ blocked: true }> {
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile) {
            throw new AppError('Profile not found.', 404);
        }
        if (profile.userId.toString() === blockerId) {
            throw new AppError('You cannot block your own profile.', 400);
        }
        await blockRepository.create(blockerId, profile.userId);
        return { blocked: true };
    }
}

export const moderationService = new ModerationService();
