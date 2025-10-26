import cron from 'node-cron';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus } from '../database/models/relance-target.model';
import CampaignModel, { CampaignType, CampaignStatus } from '../database/models/relance-campaign.model';
import { userServiceClient } from '../services/clients/user.service.client';
import { campaignService } from '../services/campaign.service';

/**
 * Enrollment Cron Job
 * Runs immediately on startup, then every hour
 *
 * Process:
 * 1. Check for campaigns that should auto-start
 * 2. Process DEFAULT campaigns (auto-enrollment from unpaid referrals)
 * 3. Process FILTERED campaigns (manual filter-based enrollment)
 */

/**
 * Enroll referrals into DEFAULT campaign
 * (Automatic enrollment: unpaid referrals > 10 minutes old)
 */
async function enrollDefaultTargets(userId: string, config: any): Promise<number> {
    let enrolled = 0;

    try {
        // Get unpaid referrals for this user
        const unpaidReferrals = await userServiceClient.getUnpaidReferrals(userId);
        console.log(`[Relance Enrollment] [Default] User ${userId} has ${unpaidReferrals.length} unpaid referrals`);

        if (unpaidReferrals.length === 0) {
            return 0;
        }

        // Process each unpaid referral
        for (const referral of unpaidReferrals) {
            try {
                const referralId = referral._id;
                const referralCreatedAt = new Date(referral.createdAt);
                const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes delay

                // Check if referral is older than 15 minutes
                if (referralCreatedAt > fifteenMinutesAgo) {
                    continue;
                }

                // Check if referral is already in the loop
                const existingTarget = await RelanceTargetModel.findOne({
                    referralUserId: referralId,
                    status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] }
                });

                if (existingTarget) {
                    continue;
                }

                // Check daily message limit
                if (config.messagesSentToday >= config.maxMessagesPerDay) {
                    console.log(`[Relance Enrollment] [Default] User ${userId} reached daily message limit (${config.maxMessagesPerDay}), skipping`);
                    break;
                }

                // Enroll referral into default campaign (no campaignId)
                const now = new Date();
                const nextMessageDue = new Date(now); // Testing: send immediately

                const newTarget = await RelanceTargetModel.create({
                    referralUserId: referralId,
                    referrerUserId: userId,
                    campaignId: null, // Default campaign has no campaignId
                    enteredLoopAt: now,
                    currentDay: 1,
                    nextMessageDue: nextMessageDue,
                    messagesDelivered: [],
                    status: TargetStatus.ACTIVE,
                    language: referral.language || 'fr'
                });

                console.log(`[Relance Enrollment] [Default] ✓ Enrolled referral ${referralId} (target: ${newTarget._id})`);
                enrolled++;

            } catch (error) {
                console.error(`[Relance Enrollment] [Default] Error enrolling referral ${referral._id}:`, error);
            }
        }

    } catch (error) {
        console.error(`[Relance Enrollment] [Default] Error for user ${userId}:`, error);
    }

    return enrolled;
}

/**
 * Enroll referrals into FILTERED campaign
 * (Manual filter-based enrollment)
 */
async function enrollFilteredTargets(userId: string, campaign: any, config: any): Promise<number> {
    let enrolled = 0;

    try {
        console.log(`[Relance Enrollment] [Filtered] Processing campaign ${campaign._id}: ${campaign.name}`);

        // Get all unpaid referrals for this user
        let unpaidReferrals = await userServiceClient.getUnpaidReferrals(userId);

        // Apply target filters
        const filter = campaign.targetFilter;

        if (!filter) {
            console.log(`[Relance Enrollment] [Filtered] Campaign ${campaign._id} has no filters, skipping`);
            return 0;
        }

        // Filter by registration date
        if (filter.registrationDateFrom || filter.registrationDateTo) {
            unpaidReferrals = unpaidReferrals.filter((ref: any) => {
                const regDate = new Date(ref.createdAt);
                if (filter.registrationDateFrom && regDate < filter.registrationDateFrom) return false;
                if (filter.registrationDateTo && regDate > filter.registrationDateTo) return false;
                return true;
            });
        }

        // Filter by country
        if (filter.countries && filter.countries.length > 0) {
            unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                filter.countries.includes(ref.country)
            );
        }

        // Filter by gender
        if (filter.gender && filter.gender !== 'all') {
            unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                ref.gender === filter.gender
            );
        }

        // Filter by profession
        if (filter.professions && filter.professions.length > 0) {
            unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                filter.professions.includes(ref.profession)
            );
        }

        // Filter by age
        if (filter.minAge || filter.maxAge) {
            unpaidReferrals = unpaidReferrals.filter((ref: any) => {
                if (!ref.age) return false;
                if (filter.minAge && ref.age < filter.minAge) return false;
                if (filter.maxAge && ref.age > filter.maxAge) return false;
                return true;
            });
        }

        // Exclude referrals already in active campaigns
        if (filter.excludeCurrentTargets) {
            const existingTargetIds = await RelanceTargetModel.distinct('referralUserId', {
                status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] }
            });

            unpaidReferrals = unpaidReferrals.filter((ref: any) =>
                !existingTargetIds.some((id: any) => id.toString() === ref._id.toString())
            );
        }

        console.log(`[Relance Enrollment] [Filtered] Campaign ${campaign._id}: ${unpaidReferrals.length} referrals match filters`);

        // Check campaign limits
        const campaignMaxMessages = campaign.maxMessagesPerDay || config.maxMessagesPerDay;
        const currentCampaignMessages = campaign.messagesSentToday || 0;

        if (currentCampaignMessages >= campaignMaxMessages) {
            console.log(`[Relance Enrollment] [Filtered] Campaign ${campaign._id} reached daily limit (${campaignMaxMessages}), skipping`);
            return 0;
        }

        // Check max targets per campaign
        if (campaign.targetsEnrolled >= config.maxTargetsPerCampaign) {
            console.log(`[Relance Enrollment] [Filtered] Campaign ${campaign._id} reached max targets (${config.maxTargetsPerCampaign}), completing`);
            campaign.status = CampaignStatus.COMPLETED;
            campaign.actualEndDate = new Date();
            await campaign.save();
            return 0;
        }

        // Enroll filtered referrals
        for (const referral of unpaidReferrals) {
            try {
                const referralId = referral._id;

                // Check if already enrolled in THIS campaign
                const existingTarget = await RelanceTargetModel.findOne({
                    referralUserId: referralId,
                    campaignId: campaign._id,
                    status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] }
                });

                if (existingTarget) {
                    continue;
                }

                // Check daily limits
                if (config.messagesSentToday >= config.maxMessagesPerDay) {
                    console.log(`[Relance Enrollment] [Filtered] User ${userId} reached daily limit, stopping enrollment`);
                    break;
                }

                if (campaign.targetsEnrolled >= config.maxTargetsPerCampaign) {
                    console.log(`[Relance Enrollment] [Filtered] Campaign ${campaign._id} reached max targets`);
                    break;
                }

                // Enroll into filtered campaign
                const now = new Date();
                const nextMessageDue = new Date(now); // Testing: send immediately

                const newTarget = await RelanceTargetModel.create({
                    referralUserId: referralId,
                    referrerUserId: userId,
                    campaignId: campaign._id,
                    enteredLoopAt: now,
                    currentDay: 1,
                    nextMessageDue: nextMessageDue,
                    messagesDelivered: [],
                    status: TargetStatus.ACTIVE,
                    language: referral.language || 'fr'
                });

                // Update campaign stats
                campaign.targetsEnrolled += 1;
                campaign.actualTargetCount = campaign.targetsEnrolled;

                console.log(`[Relance Enrollment] [Filtered] ✓ Enrolled referral ${referralId} into campaign ${campaign._id} (target: ${newTarget._id})`);
                enrolled++;

            } catch (error) {
                console.error(`[Relance Enrollment] [Filtered] Error enrolling referral ${referral._id}:`, error);
            }
        }

        // Save campaign stats
        await campaign.save();

    } catch (error) {
        console.error(`[Relance Enrollment] [Filtered] Error processing campaign ${campaign._id}:`, error);
    }

    return enrolled;
}

/**
 * Main enrollment check function
 */
async function runEnrollmentCheck() {
    console.log('[Relance Enrollment] Starting enrollment check...');
    const startTime = Date.now();

    try {
        // STEP 1: Check for campaigns that should auto-start
        const nextCampaign = await campaignService.getNextCampaignToStart();
        if (nextCampaign) {
            console.log(`[Relance Enrollment] Auto-starting campaign ${nextCampaign._id}: ${nextCampaign.name}`);
            await campaignService.startCampaign(nextCampaign._id.toString(), nextCampaign.userId.toString());
        }

        // STEP 2: Find all users with active relance configs
        const activeConfigs = await RelanceConfigModel.find({
            enabled: true,
            enrollmentPaused: false,
            whatsappStatus: 'connected'
        });

        console.log(`[Relance Enrollment] Found ${activeConfigs.length} active configs to process`);

        let totalDefaultEnrolled = 0;
        let totalFilteredEnrolled = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (const config of activeConfigs) {
            try {
                const userId = config.userId.toString();

                // Check if user has active relance subscription
                const hasRelance = await userServiceClient.hasRelanceSubscription(userId);
                if (!hasRelance) {
                    console.log(`[Relance Enrollment] User ${userId} no longer has active RELANCE subscription, skipping`);
                    totalSkipped++;
                    continue;
                }

                // STEP 3: Process DEFAULT campaign (if not paused)
                if (!config.defaultCampaignPaused) {
                    const defaultEnrolled = await enrollDefaultTargets(userId, config);
                    totalDefaultEnrolled += defaultEnrolled;
                } else {
                    console.log(`[Relance Enrollment] [Default] Paused for user ${userId}`);
                }

                // STEP 4: Process FILTERED campaigns
                const activeCampaigns = await CampaignModel.find({
                    userId: config.userId,
                    type: CampaignType.FILTERED,
                    status: CampaignStatus.ACTIVE
                });

                console.log(`[Relance Enrollment] [Filtered] User ${userId} has ${activeCampaigns.length} active filtered campaigns`);

                for (const campaign of activeCampaigns) {
                    const filteredEnrolled = await enrollFilteredTargets(userId, campaign, config);
                    totalFilteredEnrolled += filteredEnrolled;
                }

            } catch (userError) {
                console.error(`[Relance Enrollment] Error processing user ${config.userId}:`, userError);
                totalErrors++;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[Relance Enrollment] Enrollment check completed in ${duration}ms`);
        console.log(`[Relance Enrollment] Summary: ${totalDefaultEnrolled} default, ${totalFilteredEnrolled} filtered, ${totalSkipped} skipped, ${totalErrors} errors`);

    } catch (error) {
        console.error('[Relance Enrollment] Fatal error in enrollment job:', error);
    }
}

export async function startRelanceEnrollmentJob() {
    console.log('[Relance Enrollment] Scheduling enrollment job - runs immediately on startup, then hourly');

    // Run immediately on startup
    await runEnrollmentCheck();

    // Run every hour at minute 0
    cron.schedule('0 * * * *', runEnrollmentCheck);

    console.log('[Relance Enrollment] Job scheduled successfully');
}
