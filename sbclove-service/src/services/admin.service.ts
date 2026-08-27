import { Types } from 'mongoose';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { userServiceClient } from './clients/user.service.client';
import { profileService, PublicProfileView } from './profile.service';
import { reportRepository } from '../database/repositories/report.repository';
import { matchRepository } from '../database/repositories/match.repository';
import { interestRepository } from '../database/repositories/interest.repository';
import { TtlCache } from '../utils/ttlCache';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { ProfileStatus, ReportStatus } from '../types/sbclove.enums';
import { IModuleConfig } from '../database/models/module-config.model';
import config from '../config';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('AdminService');

// The dashboard totals are four aggregations over whole collections. They are
// read by a handful of admins, change slowly, and nobody needs them to the
// second — so one cached copy serves every admin tab open.
const statsCache = new TtlCache<AdminStats>(60 * 1000, 1);

/** One row of the SBCLOVE member directory. */
export interface AdminMemberRow {
    _id: string;
    userId: string;
    displayName: string;
    memberName?: string;
    memberEmail?: string;
    sex?: string;
    ageBracket: string | null;
    city?: string;
    status: string;
    photoCount: number;
    photoUrl?: string;
    reportCount: number;
    matches: number;          // matches this member is part of
    conversations: number;    // matches that turned into a chat
    createdAt?: Date;
}

export interface AdminStats {
    profiles: { total: number; pending: number; approved: number; rejected: number; suspended: number };
    matches: { total: number; contactUnlocked: number; conversations: number };
    interests: { total: number };
    reports: { open: number };
}

/** A profile as the validation queue needs it: judgeable at a glance. */
export interface AdminProfileView extends PublicProfileView {
    _id: string;
    memberName?: string;
    memberEmail?: string;
    memberVerified?: boolean;
    photoCount: number;
    minPhotos: number;
    meetsPhotoRequirement: boolean;
    moderation: {
        validatedBy?: string;
        validatedAt?: Date;
        rejectionReason?: string;
        reportCount: number;
        suspendedAt?: Date;
    };
    updatedAt?: Date;
}

class AdminService {

    /**
     * Lists profiles for the admin validation queue (spec §8, §14).
     *
     * Returns the profile as an admin has to judge it, not as it is stored: the
     * photos as CLEAR urls (the whole decision is "is this a real portrait and a
     * real full-body shot"), the description to read for forbidden content, and
     * the SBC member behind it. A queue of display names and dates cannot be
     * validated at all — which is what this used to be.
     */
    async listProfiles(status: ProfileStatus | undefined, limit: number, skip: number): Promise<{ items: AdminProfileView[]; total: number }> {
        const query = status ? { status } : {};
        const [profiles, total] = await Promise.all([
            loveProfileRepository.find(query, limit, skip),
            loveProfileRepository.count(query),
        ]);

        const users = await userServiceClient.getUsersByIds(profiles.map(p => p.userId.toString()));
        const userMap = new Map(users.map(u => [u._id.toString(), u]));

        const items = profiles.map(profile => {
            const user = userMap.get(profile.userId.toString());
            const view = profileService.present(profile, user, /* canSeeClearPhotos */ true);
            return {
                ...view,
                _id: view.id,                    // the admin frontend keys on _id
                memberName: user?.name,
                memberEmail: user?.email,
                memberVerified: user?.isVerified,
                photoCount: profile.photos.length,
                minPhotos: config.sbclove.minPhotos,
                // Approval is refused below the minimum, so the queue says so up
                // front instead of letting the admin discover it via a 400.
                meetsPhotoRequirement: profile.photos.length >= config.sbclove.minPhotos,
                moderation: {
                    validatedBy: profile.moderation?.validatedBy?.toString(),
                    validatedAt: profile.moderation?.validatedAt,
                    rejectionReason: profile.moderation?.rejectionReason,
                    reportCount: profile.moderation?.reportCount ?? 0,
                    suspendedAt: profile.moderation?.suspendedAt,
                },
                updatedAt: profile.updatedAt,
            };
        });

        return { items, total };
    }

    /** Approves or rejects a profile (spec §8). */
    async validateProfile(adminId: string, profileId: string, approve: boolean, rejectionReason?: string) {
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile) {
            throw new AppError('Profile not found.', 404);
        }
        if (approve && profile.photos.length < config.sbclove.minPhotos) {
            throw new AppError(`Cannot approve a profile with fewer than ${config.sbclove.minPhotos} photos.`, 400);
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

    /**
     * The SBCLOVE member directory: every profile, with how many matches it has
     * and how many of those became conversations.
     *
     * Cost is bounded by the page, not by the member base: one indexed page of
     * profiles, ONE aggregation for the whole page's match/conversation counts,
     * and one (cached) batch hydration. No per-row queries.
     */
    async listMembers(status: ProfileStatus | undefined, limit: number, skip: number): Promise<{ items: AdminMemberRow[]; total: number }> {
        const query = status ? { status } : {};
        const [profiles, total] = await Promise.all([
            loveProfileRepository.find(query, limit, skip),
            loveProfileRepository.count(query),
        ]);
        if (profiles.length === 0) {
            return { items: [], total };
        }

        const userIds = profiles.map(p => p.userId.toString());
        const [users, counts] = await Promise.all([
            userServiceClient.getUsersByIds(userIds),
            matchRepository.countsByUserIds(userIds),
        ]);
        const userMap = new Map(users.map(u => [u._id.toString(), u]));

        const items = profiles.map(profile => {
            const key = profile.userId.toString();
            const user = userMap.get(key);
            const view = profileService.present(profile, user, /* canSeeClearPhotos */ true);
            const tally = counts.get(key);
            return {
                _id: view.id,
                userId: key,
                displayName: view.displayName,
                memberName: user?.name,
                memberEmail: user?.email,
                sex: view.sex,
                ageBracket: view.ageBracket,
                city: view.city,
                status: view.status,
                photoCount: profile.photos.length,
                photoUrl: view.photos[0]?.url,
                reportCount: profile.moderation?.reportCount ?? 0,
                matches: tally?.matches ?? 0,
                conversations: tally?.conversations ?? 0,
                createdAt: profile.createdAt,
            };
        });

        return { items, total };
    }

    /** Dashboard totals (cached — see statsCache). */
    async getStats(): Promise<AdminStats> {
        return statsCache.through('stats', async () => {
            const [byStatus, matchTotals, interests, openReports] = await Promise.all([
                loveProfileRepository.countByStatus(),
                matchRepository.totals(),
                interestRepository.countAll(),
                reportRepository.count({ status: ReportStatus.OPEN }),
            ]);
            const profiles = {
                pending: byStatus[ProfileStatus.PENDING] ?? 0,
                approved: byStatus[ProfileStatus.APPROVED] ?? 0,
                rejected: byStatus[ProfileStatus.REJECTED] ?? 0,
                suspended: byStatus[ProfileStatus.SUSPENDED] ?? 0,
                total: Object.values(byStatus).reduce((a, b) => a + b, 0),
            };
            return {
                profiles,
                matches: {
                    total: matchTotals.matches,
                    contactUnlocked: matchTotals.contactUnlocked,
                    conversations: matchTotals.conversations,
                },
                interests: { total: interests },
                reports: { open: openReports },
            };
        });
    }

    /**
     * Reports for the moderation queue, hydrated.
     *
     * The raw rows carry nothing but ObjectIds — an admin cannot judge "user
     * 6848a4… reported 6a904d…". Both sides are resolved (one batch call, from
     * the cached hydration) so the queue names the people involved.
     */
    async listReports(status: ReportStatus | undefined, limit: number, skip: number) {
        const query = status ? { status } : {};
        const [reports, total] = await Promise.all([
            reportRepository.find(query, limit, skip),
            reportRepository.count(query),
        ]);
        if (reports.length === 0) return { items: [], total };

        const ids = new Set<string>();
        for (const r of reports) {
            ids.add(r.reporterId.toString());
            ids.add(r.reportedUserId.toString());
        }
        const [users, profiles] = await Promise.all([
            userServiceClient.getUsersByIds([...ids]),
            loveProfileRepository.findByUserIds([...ids]),
        ]);
        const userMap = new Map(users.map(u => [u._id.toString(), u]));
        const profileMap = new Map(profiles.map(p => [p.userId.toString(), p]));

        const label = (userId: string) => {
            const profile = profileMap.get(userId);
            const user = userMap.get(userId);
            return {
                userId,
                displayName: profile?.displayName || user?.name || 'Membre SBC',
                email: user?.email,
                profileId: profile?._id?.toString(),
                profileStatus: profile?.status,
                reportCount: profile?.moderation?.reportCount ?? 0,
            };
        };

        const items = reports.map(r => ({
            ...r,
            reporter: label(r.reporterId.toString()),
            reported: label(r.reportedUserId.toString()),
        }));

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
