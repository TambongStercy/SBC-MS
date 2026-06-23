import { Types } from 'mongoose';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { blockRepository } from '../database/repositories/block.repository';
import { ILoveProfile, IProfilePhoto } from '../database/models/love-profile.model';
import { Intention, ProfileStatus, ageBracketFromBirthDate } from '../types/sbclove.enums';
import { userServiceClient, UserDetails } from './clients/user.service.client';
import { settingsServiceClient } from './clients/settings.service.client';
import { validateProfileText } from '../utils/contentFilter';
import { AppError } from '../utils/errors';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('ProfileService');

export interface CreateProfileInput {
    displayName?: string;
    intention: Intention;
    otherIntentionText?: string;
    description: string;
}

// Shape returned to clients: SBCLOVE-owned data + hydrated user demographics,
// with photo visibility resolved per the requesting viewer (spec §3, §4, §6).
export interface PublicProfileView {
    id: string;
    userId: string;
    displayName: string;
    sex?: string;
    ageBracket: string | null;
    city?: string;
    country?: string;
    intention: Intention;
    otherIntentionText?: string;
    description: string;
    status: ProfileStatus;
    photos: { url: string; blurred: boolean; order: number }[];
    createdAt?: Date;
}

class ProfileService {

    /** Validates SBCLOVE-owned text fields against config + content rules (spec §5, §7). */
    private validateContent(input: { displayName?: string; description: string; intention: Intention; otherIntentionText?: string }): void {
        if (!input.description || input.description.trim().length === 0) {
            throw new AppError('Description is required.', 400);
        }
        if (input.description.length > config.sbclove.descriptionMaxLength) {
            throw new AppError(`Description must be at most ${config.sbclove.descriptionMaxLength} characters.`, 400);
        }
        if (input.intention === Intention.OTHER) {
            if (!input.otherIntentionText || input.otherIntentionText.trim().length === 0) {
                throw new AppError('A custom intention text is required when intention is "autre".', 400);
            }
            if (input.otherIntentionText.length > config.sbclove.otherIntentionMaxLength) {
                throw new AppError(`Custom intention must be at most ${config.sbclove.otherIntentionMaxLength} characters.`, 400);
            }
        }
        for (const [field, value] of Object.entries({ displayName: input.displayName, description: input.description, otherIntentionText: input.otherIntentionText })) {
            const result = validateProfileText(value);
            if (!result.ok) {
                throw new AppError(`Forbidden content in ${field}: ${result.violation} is not allowed.`, 400);
            }
        }
    }

    /** Creates the caller's SBCLOVE profile (spec §4). Requires a verified SBC account (spec §3). */
    async createProfile(userId: string, input: CreateProfileInput): Promise<PublicProfileView> {
        const existing = await loveProfileRepository.findByUserId(userId);
        if (existing) {
            throw new AppError('You already have a SBCLOVE profile.', 409);
        }

        const user = await userServiceClient.getUserById(userId);
        if (!user) {
            throw new AppError('SBC user account not found.', 404);
        }
        if (!user.isVerified) {
            throw new AppError('Your email must be verified before creating a SBCLOVE profile.', 403);
        }

        this.validateContent(input);

        const profile = await loveProfileRepository.create({
            userId: new Types.ObjectId(userId),
            displayName: input.displayName?.trim(),
            intention: input.intention,
            otherIntentionText: input.intention === Intention.OTHER ? input.otherIntentionText?.trim() : undefined,
            description: input.description.trim(),
            photos: [],
            status: ProfileStatus.PENDING, // every profile starts pending (spec §7)
        });

        return this.present(profile, user, /* canSeeClearPhotos */ true);
    }

    async getMyProfile(userId: string): Promise<PublicProfileView | null> {
        const profile = await loveProfileRepository.findByUserId(userId);
        if (!profile) return null;
        const user = await userServiceClient.getUserById(userId);
        return this.present(profile, user, true);
    }

    async updateProfile(userId: string, input: Partial<CreateProfileInput>): Promise<PublicProfileView> {
        const profile = await loveProfileRepository.findByUserId(userId);
        if (!profile) {
            throw new AppError('SBCLOVE profile not found.', 404);
        }
        const merged = {
            displayName: input.displayName ?? profile.displayName,
            description: input.description ?? profile.description,
            intention: input.intention ?? profile.intention,
            otherIntentionText: input.otherIntentionText ?? profile.otherIntentionText,
        };
        this.validateContent(merged as any);

        // Any edit re-enters the validation queue (spec §7).
        const updated = await loveProfileRepository.updateByUserId(userId, {
            displayName: merged.displayName?.trim(),
            intention: merged.intention,
            otherIntentionText: merged.intention === Intention.OTHER ? merged.otherIntentionText?.trim() : undefined,
            description: merged.description?.trim(),
            status: ProfileStatus.PENDING,
        });

        const user = await userServiceClient.getUserById(userId);
        return this.present(updated as ILoveProfile, user, true);
    }

    /** Adds uploaded photos (already stored in settings-service) to the caller's profile. */
    async addPhotos(userId: string, files: { buffer: Buffer; originalname: string; mimetype: string }[]): Promise<PublicProfileView> {
        const profile = await loveProfileRepository.findByUserId(userId);
        if (!profile) {
            throw new AppError('SBCLOVE profile not found.', 404);
        }
        const remaining = config.sbclove.maxPhotos - profile.photos.length;
        if (files.length > remaining) {
            throw new AppError(`You can upload at most ${config.sbclove.maxPhotos} photos (${remaining} slot(s) left).`, 400);
        }

        const newPhotos: IProfilePhoto[] = [];
        let order = profile.photos.length;
        for (const file of files) {
            const fileId = await settingsServiceClient.uploadPrivatePhoto(file.buffer, file.originalname, file.mimetype);
            // NOTE (Phase 3): generate and store a blurred derivative; for now blurredFileId is unset.
            newPhotos.push({ fileId, order: order++ });
        }

        const updated = await loveProfileRepository.updateByUserId(userId, {
            photos: [...profile.photos, ...newPhotos],
        });
        const user = await userServiceClient.getUserById(userId);
        return this.present(updated as ILoveProfile, user, true);
    }

    /**
     * Browses approved profiles (spec §4). Excludes the caller, blocked users,
     * and suspended/non-approved profiles. Photos are blurred for viewers
     * without their own approved profile (spec §3, §6).
     */
    async browse(viewerUserId: string, limit: number, skip: number): Promise<{ items: PublicProfileView[]; total: number }> {
        const viewerProfile = await loveProfileRepository.findByUserId(viewerUserId);
        const viewerCanSeeClearPhotos = !!viewerProfile && viewerProfile.status === ProfileStatus.APPROVED;

        const blockedIds = await blockRepository.findRelatedUserIds(viewerUserId);
        const excludeUserIds = [new Types.ObjectId(viewerUserId), ...blockedIds.map(id => new Types.ObjectId(id))];

        const query = {
            status: ProfileStatus.APPROVED,
            userId: { $nin: excludeUserIds },
        };

        const [profiles, total] = await Promise.all([
            loveProfileRepository.find(query, limit, skip),
            loveProfileRepository.count(query),
        ]);

        const users = await userServiceClient.getUsersByIds(profiles.map(p => p.userId.toString()));
        const userMap = new Map(users.map(u => [u._id.toString(), u]));

        const items = profiles.map(p => this.present(p, userMap.get(p.userId.toString()), viewerCanSeeClearPhotos));
        return { items, total };
    }

    async getProfileForViewer(viewerUserId: string, profileId: string): Promise<PublicProfileView> {
        const profile = await loveProfileRepository.findById(profileId);
        if (!profile || profile.status !== ProfileStatus.APPROVED) {
            throw new AppError('Profile not found.', 404);
        }
        if (await blockRepository.exists(viewerUserId, profile.userId) || await blockRepository.exists(profile.userId, viewerUserId)) {
            throw new AppError('Profile not found.', 404);
        }
        const viewerProfile = await loveProfileRepository.findByUserId(viewerUserId);
        const viewerCanSeeClearPhotos = !!viewerProfile && viewerProfile.status === ProfileStatus.APPROVED;
        const user = await userServiceClient.getUserById(profile.userId.toString());
        return this.present(profile, user, viewerCanSeeClearPhotos);
    }

    /** Combines a LoveProfile with hydrated user data into a viewer-aware view. */
    present(profile: ILoveProfile, user: UserDetails | null | undefined, canSeeClearPhotos: boolean): PublicProfileView {
        return {
            id: profile._id.toString(),
            userId: profile.userId.toString(),
            displayName: profile.displayName || user?.name || 'Membre SBC',
            sex: user?.sex,
            ageBracket: ageBracketFromBirthDate(user?.birthDate),
            city: user?.city,
            country: user?.country,
            intention: profile.intention,
            otherIntentionText: profile.otherIntentionText,
            description: profile.description,
            status: profile.status,
            photos: profile.photos
                .slice()
                .sort((a, b) => a.order - b.order)
                .map(ph => {
                    // Clear photo only when the viewer is allowed AND a clear file exists.
                    if (canSeeClearPhotos) {
                        return { url: settingsServiceClient.getFileUrl(ph.fileId), blurred: false, order: ph.order };
                    }
                    const id = ph.blurredFileId || ph.fileId; // fall back to original id; frontend overlays until blur exists
                    return { url: settingsServiceClient.getFileUrl(id), blurred: true, order: ph.order };
                }),
            createdAt: profile.createdAt,
        };
    }
}

export const profileService = new ProfileService();
