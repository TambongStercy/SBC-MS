import { Types } from 'mongoose';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { reportRepository } from '../database/repositories/report.repository';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { ProfileStatus, ReportStatus } from '../types/sbclove.enums';
import { IModuleConfig } from '../database/models/module-config.model';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('AdminService');

class AdminService {

    /** Lists profiles by status for the admin validation queue (spec §8, §14). */
    async listProfiles(status: ProfileStatus | undefined, limit: number, skip: number) {
        const query = status ? { status } : {};
        const [items, total] = await Promise.all([
            loveProfileRepository.find(query, limit, skip),
            loveProfileRepository.count(query),
        ]);
        return { items, total };
    }

    /** Approves or rejects a profile (spec §8). */
    async validateProfile(adminId: string, profileId: string, approve: boolean, rejectionReason?: string) {
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile) {
            throw new AppError('Profile not found.', 404);
        }
        if (approve && profile.photos.length === 0) {
            throw new AppError('Cannot approve a profile without at least one photo.', 400);
        }
        const status = approve ? ProfileStatus.APPROVED : ProfileStatus.REJECTED;
        const updated = await loveProfileRepository.setStatus(profileId, status, {
            validatedBy: new Types.ObjectId(adminId),
            validatedAt: new Date(),
            rejectionReason: approve ? undefined : rejectionReason,
        });
        log.info(`Admin ${adminId} set profile ${profileId} to ${status}.`);
        return updated;
    }

    /**
     * Manually suspends or reinstates a profile (spec §14). Reinstating clears
     * the report counter so an old report tally can't immediately re-suspend it.
     */
    async setSuspension(adminId: string, profileId: string, suspend: boolean, reason?: string) {
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile) {
            throw new AppError('Profile not found.', 404);
        }
        if (suspend) {
            const updated = await loveProfileRepository.setStatus(profileId, ProfileStatus.SUSPENDED, {
                suspendedAt: new Date(),
                rejectionReason: reason,
                validatedBy: new Types.ObjectId(adminId),
                validatedAt: new Date(),
            });
            log.info(`Admin ${adminId} suspended profile ${profileId}.`);
            return updated;
        }
        // Reinstate → back to approved, reset the report tally.
        const updated = await loveProfileRepository.setStatus(profileId, ProfileStatus.APPROVED, {
            suspendedAt: undefined,
            reportCount: 0,
            validatedBy: new Types.ObjectId(adminId),
            validatedAt: new Date(),
        });
        log.info(`Admin ${adminId} reinstated profile ${profileId}.`);
        return updated;
    }

    async listReports(status: ReportStatus | undefined, limit: number, skip: number) {
        const query = status ? { status } : {};
        const [items, total] = await Promise.all([
            reportRepository.find(query, limit, skip),
            reportRepository.count(query),
        ]);
        return { items, total };
    }

    async reviewReport(adminId: string, reportId: string, status: ReportStatus) {
        const updated = await reportRepository.setStatus(reportId, status, adminId);
        if (!updated) {
            throw new AppError('Report not found.', 404);
        }
        return updated;
    }

    async getModuleConfig(): Promise<IModuleConfig> {
        return moduleConfigRepository.get();
    }

    /** Updates module config including the global enable/disable kill-switch (spec §14). */
    async updateModuleConfig(adminId: string, data: Partial<IModuleConfig>): Promise<IModuleConfig> {
        return moduleConfigRepository.update(data, adminId);
    }
}

export const adminService = new AdminService();
