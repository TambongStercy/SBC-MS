import { Types } from 'mongoose';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { blockRepository } from '../database/repositories/block.repository';
import { interestRepository } from '../database/repositories/interest.repository';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { ILoveProfile, IProfilePhoto } from '../database/models/love-profile.model';
import { Intention, ProfileStatus, ageBracketFromBirthDate, oppositeSex } from '../types/sbclove.enums';
import { userServiceClient, UserDetails } from './clients/user.service.client';
import { settingsServiceClient } from './clients/settings.service.client';
import { validateProfileText } from '../utils/contentFilter';
import { generateBlurredDerivative } from '../utils/imageProcessing';
import { AppError } from '../utils/errors';
import config from '../config';
import { TtlCache } from '../utils/ttlCache';
import logger from '../utils/logger';

const log = logger.getLogger('ProfileService');

const DISPLAY_NAME_MAX_LENGTH = 50;

// How many approved profiles exist for a given sex. It changes when a profile is
// approved or suspended — never mid-swipe — and only feeds the pagination block,
// so every viewer in the session can share one 30s-old number instead of each
// paying for a full index scan.
const deckCountCache = new TtlCache<number>(30 * 1000, 16);

/** A random window start, so two members rarely open the same page of the deck. */
const randomOffset = (total: number, limit: number): number =>
    total <= limit ? 0 : Math.floor(Math.random() * (total - limit + 1));


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
    memberSince?: Date;    // SBC join date, shown on the profile detail
    // `fileId` is the id of the photo the viewer is actually served (the blurred
    // derivative for viewers without an approved profile), so a client can act on
    // a photo — delete, reorder — without parsing it back out of the URL.
    photos: { fileId: string; url?: string; blurred: boolean; order: number }[];
    createdAt?: Date;
}

class ProfileService {

    /** Validates SBCLOVE-owned text fields against config + content rules (spec §5, §7). */
    private validateContent(input: { displayName?: string; description: string; intention: Intention; otherIntentionText?: string }): void {
        if (!input.intention || !Object.values(Intention).includes(input.intention)) {
            throw new AppError(`Invalid intention. Allowed values: ${Object.values(Intention).join(', ')}.`, 400);
        }
        if (input.displayName !== undefined && input.displayName.length > DISPLAY_NAME_MAX_LENGTH) {
            throw new AppError(`Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`, 400);
        }
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
            sex: user.sex,   // denormalised for the opposite-sex browse filter
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

        // Any edit re-enters the validation queue (spec §7). The sex copy is
        // refreshed here so a correction made in the SBC profile reaches the
        // browse filter instead of pinning the member to the wrong side of it.
        const owner = await userServiceClient.getUserById(userId);
        let updated = await loveProfileRepository.updateByUserId(userId, {
            sex: owner?.sex,
            displayName: merged.displayName?.trim(),
            intention: merged.intention,
            otherIntentionText: merged.intention === Intention.OTHER ? merged.otherIntentionText?.trim() : undefined,
            description: merged.description?.trim(),
            status: ProfileStatus.PENDING,
        });
        updated = await this.maybeAutoApprove(updated as ILoveProfile) ?? updated;

        return this.present(updated as ILoveProfile, owner, true);
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
            const uploaded = await settingsServiceClient.uploadPhoto(file.buffer, file.originalname, file.mimetype);

            // Generate and store a blurred derivative served to non-profile viewers (spec §6).
            let blurredFileId: string | undefined;
            const blurredBuffer = await generateBlurredDerivative(file.buffer);
            if (blurredBuffer) {
                const blurredName = `blurred-${file.originalname.replace(/\.[^.]+$/, '')}.jpg`;
                const blurredUpload = await settingsServiceClient.uploadPhoto(blurredBuffer, blurredName, 'image/jpeg');
                blurredFileId = blurredUpload.fileId;
            } else {
                log.warn(`Blur generation failed for a photo of user ${userId}; it will not be browsable until reprocessed.`);
            }

            newPhotos.push({ fileId: uploaded.fileId, blurredFileId, order: order++ });
        }

        let updated = await loveProfileRepository.updateByUserId(userId, {
            photos: [...profile.photos, ...newPhotos],
        });
        updated = await this.maybeAutoApprove(updated as ILoveProfile) ?? updated;
        const user = await userServiceClient.getUserById(userId);
        return this.present(updated as ILoveProfile, user, true);
    }

    /**
     * Deletes a photo from the caller's profile by fileId and renumbers order.
     * (The underlying storage object is left for a later cleanup pass.)
     */
    async deletePhoto(userId: string, fileId: string): Promise<PublicProfileView> {
        const profile = await loveProfileRepository.findByUserId(userId);
        if (!profile) {
            throw new AppError('SBCLOVE profile not found.', 404);
        }
        const remaining = profile.photos.filter(p => p.fileId !== fileId);
        if (remaining.length === profile.photos.length) {
            throw new AppError('Photo not found on your profile.', 404);
        }
        const renumbered = remaining
            .sort((a, b) => a.order - b.order)
            .map((p, idx) => ({ ...p, order: idx }));

        const updated = await loveProfileRepository.updateByUserId(userId, { photos: renumbered });
        const user = await userServiceClient.getUserById(userId);
        return this.present(updated as ILoveProfile, user, true);
    }

    /**
     * Reorders the caller's photos to match the given fileId order.
     */
    async reorderPhotos(userId: string, orderedFileIds: string[]): Promise<PublicProfileView> {
        const profile = await loveProfileRepository.findByUserId(userId);
        if (!profile) {
            throw new AppError('SBCLOVE profile not found.', 404);
        }
        const current = new Set(profile.photos.map(p => p.fileId));
        if (orderedFileIds.length !== profile.photos.length || !orderedFileIds.every(id => current.has(id))) {
            throw new AppError('The provided photo order must contain exactly your existing photos.', 400);
        }
        const byId = new Map(profile.photos.map(p => [p.fileId, p]));
        const reordered = orderedFileIds.map((id, idx) => ({ ...byId.get(id)!, order: idx }));

        const updated = await loveProfileRepository.updateByUserId(userId, { photos: reordered });
        const user = await userServiceClient.getUserById(userId);
        return this.present(updated as ILoveProfile, user, true);
    }

    /**
     * If auto-approval is enabled (spec §7) and the profile is pending with at
     * least one photo, transitions it to approved. Returns the updated doc or
     * null when no change was made.
     */
    private async maybeAutoApprove(profile: ILoveProfile): Promise<ILoveProfile | null> {
        if (!profile || profile.status !== ProfileStatus.PENDING) {
            return null;
        }
        if (profile.photos.length < config.sbclove.minPhotos) {
            return null;
        }
        const cfg = await moduleConfigRepository.get();
        if (!cfg.autoApprove) {
            return null;
        }
        return loveProfileRepository.setStatus(profile._id, ProfileStatus.APPROVED, {
            validatedAt: new Date(),
        });
    }

    /**
     * Browses approved profiles (spec §4). Excludes the caller, blocked users,
     * and suspended/non-approved profiles. Photos are blurred for viewers
     * without their own approved profile (spec §3, §6).
     */
    async browse(viewerUserId: string, limit: number, skip: number): Promise<{ items: PublicProfileView[]; total: number }> {
        const viewerProfile = await loveProfileRepository.findByUserId(viewerUserId);
        const viewerCanSeeClearPhotos = !!viewerProfile && viewerProfile.status === ProfileStatus.APPROVED;

        // Hide anyone already dealt with: yourself, blocks (either direction) and
        // anyone you already expressed interest in — including your matches, since
        // a match cannot exist without your interest. Their card would be inert
        // anyway: the pair is unique, so a second interest answers 409.
        const [blockedIds, alreadyInterested] = await Promise.all([
            blockRepository.findRelatedUserIds(viewerUserId),
            interestRepository.findSentToUserIds(viewerUserId),
        ]);
        const excludeUserIds = [
            new Types.ObjectId(viewerUserId),
            ...blockedIds.map(id => new Types.ObjectId(id)),
            ...alreadyInterested,
        ];

        // SBCLOVE proposes the opposite sex, always (§16: serious connections).
        // The viewer's own sex comes from their profile copy; a member browsing
        // before creating one costs a single user-service call.
        let viewerSex = viewerProfile?.sex;
        if (!viewerSex) {
            viewerSex = (await userServiceClient.getUserById(viewerUserId))?.sex;
        }

        const query: Record<string, unknown> = {
            status: ProfileStatus.APPROVED,
            userId: { $nin: excludeUserIds },
        };

        const opposite = oppositeSex(viewerSex);
        if (opposite) {
            query.sex = opposite;
        } else {
            // 'other' / 'prefer_not_to_say' / missing: there is no opposite to
            // compute, so no sex filter is applied rather than an empty deck.
            log.warn(`No opposite sex for viewer ${viewerUserId} (sex=${viewerSex ?? 'unknown'}); browsing unfiltered.`);
        }

        // The per-viewer exclusions are left out of the cached count on purpose:
        // they differ for everyone, and `total` is a rough "how many are out
        // there", not a promise about this viewer's deck length.
        const total = await deckCountCache.through(`approved:${opposite ?? 'all'}`, () =>
            loveProfileRepository.count({ status: ProfileStatus.APPROVED, ...(opposite ? { sex: opposite } : {}) }));

        // Everyone's deck starts at a random offset rather than at the newest
        // profile. Sorted newest-first, a large member base would mean every
        // member is shown the same first page: the newest profiles collect every
        // interest, older ones are never proposed at all, and one page of the
        // index takes the whole session's traffic. An explicit page (skip > 0)
        // is still honoured for anyone paging deliberately.
        const offset = skip > 0 ? skip : randomOffset(total, limit);

        const profiles = await loveProfileRepository.find(query, limit, offset);

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
            memberSince: user?.createdAt ? new Date(user.createdAt) : undefined,
            photos: profile.photos
                .slice()
                .sort((a, b) => a.order - b.order)
                .map(ph => {
                    if (canSeeClearPhotos) {
                        return { fileId: ph.fileId, url: settingsServiceClient.getFileUrl(ph.fileId), blurred: false, order: ph.order };
                    }
                    // Non-approved viewer: ONLY ever serve the blurred derivative. If none
                    // exists, serve no URL at all rather than leak the clear image (spec §3, §6).
                    return ph.blurredFileId
                        ? { fileId: ph.blurredFileId, url: settingsServiceClient.getFileUrl(ph.blurredFileId), blurred: true, order: ph.order }
                        : { fileId: ph.fileId, url: undefined, blurred: true, order: ph.order };
                }),
            createdAt: profile.createdAt,
        };
    }
}

export const profileService = new ProfileService();
