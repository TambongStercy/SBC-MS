import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus, DayStatus, IDayProof } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import { newLandingPageSlug, newTrackingCode } from './campaign.service';
import { openParticipation } from './day-window.service';
import { notifyCampaignOffer } from './clients/notification.service.client';
import config from '../config';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('TestCampaignService');

/** Day slots that can never earn anything, whatever gets verified against them. */
const zeroRateDays = (): IDayProof[] =>
    Array.from({ length: config.campaign.durationDays }, (_, i) => ({
        day: i + 1,
        status: DayStatus.PENDING,
        viewCount: 0,
        deliveredCount: 0,
        ratePerView: 0,
        earnedAmount: 0,
    }));

/** The live test campaign, or null when an admin has not configured one. */
export const getTestCampaign = async (): Promise<ICampaign | null> =>
    CampaignModel.findOne({ isTestCampaign: true, status: CampaignStatus.ACTIVE });

type TestCampaignInput = {
    title: string;
    description?: string;
    mediaFileId: string;
    mediaType: 'image' | 'video';
    mediaMimeType?: string;
    suggestedCaption?: string;
    landingVideoFileId?: string;
    contactWhatsapp?: string;
    contactPhone?: string;
    websiteUrl?: string;
    /** Admin override: apply a creative change despite in-flight runs. */
    force?: boolean;
};

/**
 * Creates or replaces the test campaign.
 *
 * Goes straight to ACTIVE: there is no annonceur to bill and no moderation queue
 * to wait in, because the admin doing this is the reviewer. That makes it the
 * only path to ACTIVE that skips both — deliberately, and only reachable behind
 * the admin role.
 *
 * Replacing retires the previous one rather than deleting it, so campaigns
 * already measured against it keep their history.
 */
export const upsertTestCampaign = async (
    adminUserId: Types.ObjectId,
    input: TestCampaignInput,
): Promise<ICampaign> => {
    if (!input.title?.trim()) throw new AppError('Un titre est requis.', 400);
    if (!input.mediaFileId) throw new AppError('Une créative est requise.', 400);

    const existing = await getTestCampaign();

    if (existing) {
        // Diffuseurs already posting this one keep posting it; editing the
        // creative mid-run would leave their verifications matching a flyer that
        // no longer exists.
        const inFlight = await CampaignParticipationModel.countDocuments({
            campaignId: existing._id,
            status: ParticipationStatus.IN_PROGRESS,
        });
        // Rufus's call: the admin may force the change. The cost is honest —
        // in-flight diffuseurs posted the old creative, so their remaining
        // verifications will compare against the new one and can flag a media
        // mismatch (advisory + trust). The 409 without force states it.
        if (inFlight > 0 && input.mediaFileId !== existing.mediaFileId && !input.force) {
            throw new AppError(
                `${inFlight} diffuseur(s) publient actuellement cette campagne test. `
                + `Modifier la créative maintenant peut pénaliser leurs vérifications en cours. `
                + `Confirmez pour forcer la modification.`,
                409,
            );
        }

        // Compared BEFORE the assign — afterwards the two are always equal, so
        // the stale perceptual hash was never cleared and every verification
        // against a changed creative would flag a false mismatch.
        const creativeChanged = input.mediaFileId !== existing.mediaFileId;

        Object.assign(existing, {
            title: input.title.trim(),
            description: input.description,
            mediaFileId: input.mediaFileId,
            mediaType: input.mediaType,
            mediaMimeType: input.mediaMimeType,
            suggestedCaption: input.suggestedCaption,
            landingVideoFileId: input.landingVideoFileId,
            contactWhatsapp: input.contactWhatsapp,
            contactPhone: input.contactPhone,
            websiteUrl: input.websiteUrl,
            reviewedBy: adminUserId,
            reviewedAt: new Date(),
        });
        if (creativeChanged) existing.mediaPerceptualHash = undefined;
        await existing.save();

        log.info(`Test campaign ${existing._id} updated by ${adminUserId}`);
        return existing;
    }

    const campaign = await CampaignModel.create({
        advertiserUserId: adminUserId,
        title: input.title.trim(),
        description: input.description,
        mediaFileId: input.mediaFileId,
        mediaType: input.mediaType,
        mediaMimeType: input.mediaMimeType,
        suggestedCaption: input.suggestedCaption,
        landingVideoFileId: input.landingVideoFileId,
        landingPageSlug: newLandingPageSlug(),
        contactWhatsapp: input.contactWhatsapp,
        contactPhone: input.contactPhone,
        websiteUrl: input.websiteUrl,
        targeting: {},
        // Nobody is billed for it, so the commercial fields are zeroed rather
        // than faked. targetUniqueViews must stay >= 1 to satisfy the schema.
        amountPaid: 0,
        pricePerUniqueView: 0,
        targetUniqueViews: 1,
        isTestCampaign: true,
        status: CampaignStatus.ACTIVE,
        activatedAt: new Date(),
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
    });

    log.info(`Test campaign ${campaign._id} created by ${adminUserId}`);
    return campaign;
};

/** Retires the current test campaign. New diffuseurs then go straight to paid work. */
export const retireTestCampaign = async (): Promise<boolean> => {
    const existing = await getTestCampaign();
    if (!existing) return false;

    existing.status = CampaignStatus.COMPLETED;
    existing.completedAt = new Date();
    await existing.save();

    // Un-accepted offers die with the campaign — leaving them alive kept the
    // retired campaign on every dashboard (« quand je clique sur retirer, ça
    // ne retire pas » — Rufus). Runs already in progress are left to finish:
    // someone mid-measurement keeps their measurement.
    const expired = await CampaignParticipationModel.updateMany(
        { campaignId: existing._id, status: ParticipationStatus.OFFERED },
        { $set: { status: ParticipationStatus.EXPIRED } },
    );

    log.info(`Test campaign ${existing._id} retired, ${expired.modifiedCount} outstanding offer(s) expired`);
    return true;
};

/**
 * Offers the test campaign to diffuseurs who have never completed one.
 *
 * Run on a schedule rather than at enrolment: a diffuseur links WhatsApp after
 * enrolling, and until they do there is nothing to verify against.
 */
export const offerTestCampaignToNewDiffuseurs = async (): Promise<number> => {
    const campaign = await getTestCampaign();
    if (!campaign) return 0;

    // Deliberately NOT filtered on whatsappLid. Linking WhatsApp happens during
    // the verification of a participation, so requiring a linked account before
    // handing out the first participation is a deadlock: no offer, so no
    // verification, so no LID, so no offer. The test campaign is where that first
    // link is meant to happen.
    // Anyone already holding an offer or a live run of ANY test campaign must not
    // get a second. Excluded BEFORE the limit below — this is the whole fix: the
    // query used to take the first 200 diffuseurs and only THEN drop those already
    // served, so once the network passed 200 diffuseurs the batch kept returning
    // the same already-offered ones and every newcomer past the limit was never
    // offered the test campaign at all (they saw "aucune campagne").
    const testCampaignIds = (await CampaignModel
        .find({ isTestCampaign: true })
        .select('_id')
        .lean()).map(c => c._id);
    const activeHolders = (await CampaignParticipationModel
        .find({
            campaignId: { $in: testCampaignIds },
            status: { $in: [ParticipationStatus.OFFERED, ParticipationStatus.IN_PROGRESS] },
        })
        .select('diffuseurUserId')
        .lean()).map(p => p.diffuseurUserId);

    const newcomers = await DiffuseurProfileModel.find({
        isActive: true,
        hasCompletedTestCampaign: false,
        userId: { $nin: activeHolders },
    }).select('_id userId').limit(200).lean();

    if (!newcomers.length) return 0;

    // Dead runs on the CURRENT campaign — forfeited, declined, expired. The
    // (campaignId, diffuseurUserId) pair is unique, so creating a second one
    // throws and the catch below swallowed it: giving up on the test campaign
    // once, or declining it, locked that diffuseur out of the whole network
    // for good, since paid work is gated on having completed it. Revive the
    // existing document instead.
    const revivable = await CampaignParticipationModel.find({
        campaignId: campaign._id,
        diffuseurUserId: { $in: newcomers.map(n => n.userId) },
        status: {
            $in: [
                ParticipationStatus.FORFEITED,
                ParticipationStatus.DECLINED,
                ParticipationStatus.EXPIRED,
            ],
        },
    });
    const revivableFor = new Map(revivable.map(p => [String(p.diffuseurUserId), p]));

    let created = 0;
    for (const profile of newcomers) {
        try {
            const previous = revivableFor.get(String(profile.userId));
            if (previous) {
                // A clean slate on the same document: new tracking code so old
                // clicks stay with the abandoned run, and fresh zero-rate days.
                previous.status = ParticipationStatus.OFFERED;
                previous.offeredAt = new Date();
                previous.acceptedAt = undefined;
                previous.startedAt = undefined;
                previous.completedAt = undefined;
                previous.day1Deadline = undefined;
                previous.completionDeadline = undefined;
                previous.trackingCode = newTrackingCode();
                previous.days = zeroRateDays();
                previous.uniqueViews = 0;
                previous.repeatViews = 0;
                previous.totalViews = 0;
                previous.totalEarned = 0;
                await previous.save();
            } else {
                await CampaignParticipationModel.create({
                    campaignId: campaign._id,
                    diffuseurUserId: profile.userId,
                    diffuseurProfileId: profile._id,
                    trackingCode: newTrackingCode(),
                    status: ParticipationStatus.OFFERED,
                    offeredAt: new Date(),
                    expectedViews: 0,
                    // Rate zero on every day. earningsFromDays multiplies views by
                    // the rate stored on the day, so this is what actually keeps the
                    // payout engine from paying for the test campaign — not a special
                    // case bolted onto the payout path.
                    days: zeroRateDays(),
                });
            }
            created++;
            void notifyCampaignOffer(String(profile.userId), campaign.title, 0);
        } catch (err) {
            log.warn(`Could not offer the test campaign to ${profile.userId}: ${(err as Error).message}`);
        }
    }

    if (created) log.info(`Offered the test campaign to ${created} new diffuseur(s)`);
    return created;
};

/**
 * Whether a diffuseur may be given paid work yet.
 *
 * Once a test campaign exists, it comes first — otherwise a newcomer's declared
 * figure gets measured on an annonceur's budget. With none configured this must
 * return true for everyone, or enrolling would lead nowhere at all.
 */
export const mayReceivePaidCampaigns = (
    hasCompletedTestCampaign: boolean,
    testCampaignExists: boolean,
): boolean => !testCampaignExists || hasCompletedTestCampaign;

/** Per-day rate. Zero for the test campaign: it buys measurement, not reach. */
export const ratePerViewFor = (campaign: Pick<ICampaign, 'isTestCampaign'>, day: number): number =>
    campaign.isTestCampaign ? 0 : (config.pricing.diffuseurRatePerDay[day - 1] ?? 0);

export { openParticipation };
