import cron from 'node-cron';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import CampaignModel, { CampaignStatus } from '../database/models/relance-campaign.model';
import { emailRelanceService } from '../services/email.relance.service';
import { userServiceClient } from '../services/clients/user.service.client';

/**
 * Email Sending Configuration
 *
 * Per-user pacing to avoid spam-like behavior:
 * - 2 seconds between emails PER USER
 * - Each user's targets are processed in parallel
 * - User A sending doesn't block User B
 *
 * SendGrid has no rate limit on mail/send (up to 10k requests/sec).
 * 2 seconds is conservative and prevents appearing spammy to recipients.
 *
 * For 1,600 targets (single user): ~54 minutes
 * For 3 users with 500 targets each: ~17 minutes (parallel)
 */
const EMAIL_DELAY_MS = 2000; // 2 seconds between emails per user

/**
 * Process a single user's targets
 * Each user runs independently with their own pacing
 */
async function processUserTargets(
    referrerId: string,
    targets: any[],
    config: any
): Promise<{ sent: number; failed: number; exited: number }> {
    let sent = 0;
    let failed = 0;
    let exited = 0;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        try {
            const referralId = target.referralUserId.toString();
            const campaign = target.campaignId as any;
            const campaignLabel = campaign ? `[Campaign:${campaign._id}]` : '[Default]';

            // Check if sending is paused
            const isDefaultTarget = !campaign;
            if (config.sendingPaused) {
                console.log(`${campaignLabel} Sending paused for referrer ${referrerId}, skipping target ${target._id}`);
                continue;
            }
            if (isDefaultTarget && !config.enabled) {
                console.log(`${campaignLabel} Default relance disabled for referrer ${referrerId}, skipping target ${target._id}`);
                continue;
            }

            // Check daily message limits
            if (config.messagesSentToday >= config.maxMessagesPerDay) {
                console.log(`${campaignLabel} User ${referrerId} reached daily limit (${config.maxMessagesPerDay}), skipping remaining`);
                break; // Stop processing this user's targets
            }

            // Check campaign-specific daily limit
            if (campaign) {
                const campaignMaxMessages = campaign.maxMessagesPerDay || config.maxMessagesPerDay;
                const campaignMessagesSent = campaign.messagesSentToday || 0;

                if (campaignMessagesSent >= campaignMaxMessages) {
                    console.log(`${campaignLabel} Campaign reached daily limit (${campaignMaxMessages}), skipping`);
                    continue;
                }
            }

            // CRITICAL: Check if message already sent for this day (prevent duplicates)
            const alreadySentToday = target.messagesDelivered.some((msg: any) => {
                return msg.day === target.currentDay && msg.status === 'delivered';
            });

            if (alreadySentToday) {
                console.log(`${campaignLabel} Message already sent for day ${target.currentDay} to target ${target._id}, skipping`);
                const nextDue = new Date();
                nextDue.setHours(nextDue.getHours() + 24);
                target.nextMessageDue = nextDue;
                target.currentDay += 1;
                await target.save();
                continue;
            }

            // Get message template (campaign custom or default)
            let messageTemplate: any = null;

            if (campaign && campaign.customMessages && campaign.customMessages.length > 0) {
                messageTemplate = campaign.customMessages.find((m: any) => m.dayNumber === target.currentDay);
            }

            if (!messageTemplate) {
                messageTemplate = await RelanceMessageModel.findOne({
                    dayNumber: target.currentDay,
                    active: true
                });
            }

            if (!messageTemplate) {
                console.log(`${campaignLabel} No message template found for day ${target.currentDay}, skipping target ${target._id}`);
                continue;
            }

            // Get referral user info
            const referralInfo = await userServiceClient.getUserDetails(referralId);
            if (!referralInfo) {
                console.log(`${campaignLabel} Could not fetch referral info for ${referralId}, skipping target ${target._id}`);
                failed++;
                continue;
            }

            // Get referrer user info
            const referrerInfo = await userServiceClient.getUserDetails(referrerId);
            if (!referrerInfo) {
                console.log(`${campaignLabel} Could not fetch referrer info for ${referrerId}, skipping target ${target._id}`);
                failed++;
                continue;
            }

            // Personalize message with variables
            const language = target.language || 'fr';
            let messageText = language === 'en' ? messageTemplate.messageTemplate.en : messageTemplate.messageTemplate.fr;

            messageText = messageText
                .replace(/\{\{name\}\}/g, referralInfo.name || 'there')
                .replace(/\{\{referrerName\}\}/g, referrerInfo.name || 'your referrer')
                .replace(/\{\{day\}\}/g, target.currentDay.toString());

            // Check for email address
            const recipientEmail = referralInfo.email;
            if (!recipientEmail) {
                console.log(`${campaignLabel} Referral ${referralId} has no email address, skipping target ${target._id}`);
                failed++;
                continue;
            }

            // Send email
            const sendResult = await emailRelanceService.sendRelanceEmail(
                recipientEmail,
                referralInfo.name || 'Member',
                referrerInfo.name || 'Your Referrer',
                messageText,
                target.currentDay,
                messageTemplate.mediaUrls,
                messageTemplate.buttons,
                messageTemplate.subject
            );

            if (sendResult.success) {
                console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] Email sent to ${recipientEmail} (Day ${target.currentDay})`);

                target.messagesDelivered.push({
                    day: target.currentDay,
                    sentAt: new Date(),
                    status: 'delivered' as any
                });
                target.lastMessageSentAt = new Date();

                // Update config message count
                config.messagesSentToday += 1;
                await config.save();

                // Update campaign stats
                if (campaign) {
                    campaign.messagesSent += 1;
                    campaign.messagesDelivered += 1;
                    campaign.messagesSentToday = (campaign.messagesSentToday || 0) + 1;
                    await campaign.save();
                }

                // Check if loop should continue
                if (target.currentDay >= 7) {
                    target.status = TargetStatus.COMPLETED;
                    target.exitReason = ExitReason.COMPLETED_7_DAYS;
                    target.exitedLoopAt = new Date();
                    console.log(`${campaignLabel} Target ${target._id} completed 7-day loop`);

                    if (campaign) {
                        campaign.targetsCompleted += 1;
                        await campaign.save();
                    }
                    exited++;
                } else {
                    target.currentDay += 1;
                    const nextDue = new Date();
                    nextDue.setHours(nextDue.getHours() + 24);
                    target.nextMessageDue = nextDue;
                }

                await target.save();
                sent++;

            } else {
                console.error(`${campaignLabel} Failed to send email to ${recipientEmail}:`, sendResult.error);

                target.messagesDelivered.push({
                    day: target.currentDay,
                    sentAt: new Date(),
                    status: 'failed' as any,
                    errorMessage: sendResult.error
                });
                await target.save();

                if (campaign) {
                    campaign.messagesFailed += 1;
                    await campaign.save();
                }
                failed++;
            }

            // Per-user delay between emails (5 seconds)
            if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, EMAIL_DELAY_MS));
            }

        } catch (targetError) {
            console.error(`[Relance Sender] Error processing target ${target._id}:`, targetError);
            failed++;
        }
    }

    return { sent, failed, exited };
}

/**
 * Main Message Sending Job
 * Groups targets by user and processes each user in parallel
 */
async function runMessageSendingJob() {
    console.log('[Relance Sender] Starting per-user parallel message sending job...');
    const startTime = Date.now();

    try {
        const now = new Date();

        // Get all ready targets
        const readyTargets = await RelanceTargetModel.find({
            status: TargetStatus.ACTIVE,
            currentDay: { $lte: 7 },
            nextMessageDue: { $lte: now }
        }).populate('campaignId');

        if (readyTargets.length === 0) {
            console.log('[Relance Sender] No targets ready for messages. Job completed.');
            return;
        }

        console.log(`[Relance Sender] Found ${readyTargets.length} targets ready for messages`);

        // Group targets by referrer (user)
        const targetsByUser = new Map<string, any[]>();
        for (const target of readyTargets) {
            const referrerId = target.referrerUserId.toString();
            if (!targetsByUser.has(referrerId)) {
                targetsByUser.set(referrerId, []);
            }
            targetsByUser.get(referrerId)!.push(target);
        }

        console.log(`[Relance Sender] Processing ${targetsByUser.size} users in parallel`);

        // Process each user's targets in parallel
        const userPromises: Promise<{ userId: string; sent: number; failed: number; exited: number }>[] = [];

        for (const [referrerId, userTargets] of targetsByUser) {
            const userPromise = (async () => {
                // Get user's config
                const config = await RelanceConfigModel.findOne({ userId: referrerId });
                if (!config) {
                    console.log(`[Relance Sender] No config found for user ${referrerId}, skipping ${userTargets.length} targets`);
                    return { userId: referrerId, sent: 0, failed: 0, exited: 0 };
                }

                // Verify user still has active relance subscription
                const hasRelance = await userServiceClient.hasRelanceSubscription(referrerId);
                if (!hasRelance) {
                    console.log(`[Relance Sender] User ${referrerId} no longer has RELANCE subscription, marking ${userTargets.length} targets as exited`);

                    // Mark all targets as exited
                    for (const target of userTargets) {
                        target.status = TargetStatus.COMPLETED;
                        target.exitReason = ExitReason.REFERRER_INACTIVE;
                        target.exitedLoopAt = new Date();
                        await target.save();

                        const campaign = target.campaignId as any;
                        if (campaign) {
                            campaign.targetsExited += 1;
                            await campaign.save();
                        }
                    }
                    return { userId: referrerId, sent: 0, failed: 0, exited: userTargets.length };
                }

                console.log(`[Relance Sender] [User:${referrerId.slice(-6)}] Processing ${userTargets.length} targets...`);
                const result = await processUserTargets(referrerId, userTargets, config);
                return { userId: referrerId, ...result };
            })();

            userPromises.push(userPromise);
        }

        // Wait for all users to complete
        const results = await Promise.all(userPromises);

        // Aggregate results
        let totalSent = 0;
        let totalFailed = 0;
        let totalExited = 0;

        for (const result of results) {
            totalSent += result.sent;
            totalFailed += result.failed;
            totalExited += result.exited;
        }

        // Check for campaigns that should be completed
        await checkAndCompleteCampaigns();

        const duration = Date.now() - startTime;
        const durationSeconds = Math.round(duration / 1000);
        console.log(`[Relance Sender] Job completed in ${durationSeconds}s`);
        console.log(`[Relance Sender] Summary: ${totalSent} sent, ${totalFailed} failed, ${totalExited} exited (${targetsByUser.size} users)`);

    } catch (error) {
        console.error('[Relance Sender] Fatal error in sender job:', error);
    }
}

/**
 * Check if any campaigns should be marked as completed
 */
async function checkAndCompleteCampaigns() {
    try {
        const activeCampaigns = await CampaignModel.find({
            status: CampaignStatus.ACTIVE
        });

        for (const campaign of activeCampaigns) {
            const activeTargets = await RelanceTargetModel.countDocuments({
                campaignId: campaign._id,
                status: TargetStatus.ACTIVE
            });

            if (activeTargets === 0) {
                console.log(`[Relance Sender] Campaign ${campaign._id} has no active targets, completing`);

                campaign.status = CampaignStatus.COMPLETED;
                campaign.actualEndDate = new Date();
                await campaign.save();

                // Check if this was the last active filtered campaign for this user
                const userActiveCampaigns = await CampaignModel.countDocuments({
                    userId: campaign.userId,
                    status: CampaignStatus.ACTIVE
                });

                if (userActiveCampaigns === 0) {
                    const config = await RelanceConfigModel.findOne({ userId: campaign.userId });
                    if (config && config.defaultCampaignPaused) {
                        config.defaultCampaignPaused = false;
                        await config.save();
                        console.log(`[Relance Sender] Resumed default campaign for user ${campaign.userId.toString()}`);
                    }
                }
            }
        }

    } catch (error) {
        console.error('[Relance Sender] Error checking campaign completion:', error);
    }
}

export function startRelanceSenderJob() {
    console.log('[Relance Sender] Scheduling per-user parallel sender job - runs every 15 minutes');

    // Run immediately on startup
    runMessageSendingJob();

    // Run every 15 minutes
    cron.schedule('*/15 * * * *', runMessageSendingJob);

    console.log('[Relance Sender] Job scheduled successfully');

    // Daily reset of message counters (runs at midnight)
    cron.schedule('0 0 * * *', async () => {
        console.log('[Relance Sender] Resetting daily message counters...');
        try {
            const configResult = await RelanceConfigModel.updateMany(
                {},
                {
                    $set: {
                        messagesSentToday: 0,
                        lastResetDate: new Date()
                    }
                }
            );

            const campaignResult = await CampaignModel.updateMany(
                { status: CampaignStatus.ACTIVE },
                {
                    $set: {
                        messagesSentToday: 0
                    }
                }
            );

            console.log(`[Relance Sender] Reset ${configResult.modifiedCount} config counters and ${campaignResult.modifiedCount} campaign counters`);
        } catch (error) {
            console.error('[Relance Sender] Error resetting message counters:', error);
        }
    });
}
