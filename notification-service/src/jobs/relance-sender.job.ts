import cron from 'node-cron';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import CampaignModel, { CampaignStatus } from '../database/models/relance-campaign.model';
import { emailRelanceService } from '../services/email.relance.service';
import { userServiceClient } from '../services/clients/user.service.client';

/**
 * Wave Configuration
 * Email-based delivery with pacing to avoid spam filters
 *
 * Strategy (60 messages/day for email):
 * - Wave 1: 15 messages, 1min between, 15min pause after
 * - Wave 2: 15 messages, 1min between, 15min pause after
 * - Wave 3: 15 messages, 1min between, 15min pause after
 * - Wave 4: 15 messages, 1min between (final wave)
 */
interface WaveConfig {
    messages: number;           // Number of messages in this wave
    delayBetween: number;       // Milliseconds between messages in this wave
    pauseAfter: number;         // Milliseconds to pause after completing this wave
}

const WAVE_CONFIGS: WaveConfig[] = [
    { messages: 15, delayBetween: 60 * 1000, pauseAfter: 15 * 60 * 1000 },    // Wave 1: 15 msgs, 1min between, 15min pause
    { messages: 15, delayBetween: 60 * 1000, pauseAfter: 15 * 60 * 1000 },    // Wave 2: 15 msgs, 1min between, 15min pause
    { messages: 15, delayBetween: 60 * 1000, pauseAfter: 15 * 60 * 1000 },    // Wave 3: 15 msgs, 1min between, 15min pause
    { messages: 15, delayBetween: 60 * 1000, pauseAfter: 0 }                   // Wave 4: 15 msgs, 1min between (final wave)
];

/**
 * Add random jitter to delay for more natural timing
 * Jitter: ±10 seconds (shorter for email)
 */
function addJitter(baseDelay: number): number {
    const jitterRange = 10 * 1000; // ±10 seconds
    const jitter = (Math.random() - 0.5) * 2 * jitterRange; // Random between -10s and +10s
    return Math.max(1000, baseDelay + jitter); // Minimum 1 second
}

/**
 * Wave-Based Message Sender
 *
 * New Logic (to prevent spam and duplicates):
 * 1. Check if there's an ACTIVE wave (targets with waveId and day < 7)
 * 2. If active wave exists:
 *    - Send messages to those targets whose nextMessageDue has passed
 *    - Continue with same wave until all reach day 7
 * 3. If no active wave (or current wave completed):
 *    - Pick up to 60 NEW targets (no waveId, status ACTIVE, nextMessageDue passed)
 *    - Assign them a new waveId
 *    - Send their messages
 *
 * This ensures:
 * - Max 60 people per wave
 * - No duplicates (same person won't be in 2 waves)
 * - Controlled sending (~60 people/week = ~240/month)
 * - Each wave completes 7-day cycle before new wave starts
 */

const WAVE_SIZE_LIMIT = 60; // Max 60 targets per wave

async function runMessageSendingJob() {
    console.log('[Relance Sender] Starting wave-based message sending job...');
    const startTime = Date.now();

    try {
        const now = new Date();

        // Step 1: Check for active wave (targets with waveId that haven't completed 7 days)
        const activeWaveTargets = await RelanceTargetModel.find({
            status: TargetStatus.ACTIVE,
            waveId: { $exists: true, $ne: null },
            currentDay: { $lte: 7 },
            nextMessageDue: { $lte: now }
        }).populate('campaignId');

        console.log(`[Relance Sender] Found ${activeWaveTargets.length} active wave targets ready for messages`);

        let targetsToProcess = activeWaveTargets;

        // Step 2: If no active wave or active wave is small, pick new targets
        if (activeWaveTargets.length === 0) {
            console.log('[Relance Sender] No active wave found. Creating new wave...');

            // Get up to 60 new targets without a waveId
            const newTargets = await RelanceTargetModel.find({
                status: TargetStatus.ACTIVE,
                waveId: { $exists: false },
                nextMessageDue: { $lte: now }
            })
            .limit(WAVE_SIZE_LIMIT)
            .populate('campaignId');

            if (newTargets.length === 0) {
                console.log('[Relance Sender] No new targets available for wave. Job completed.');
                return;
            }

            // Assign new waveId to these targets
            const newWaveId = `wave_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const newWaveDate = new Date();

            console.log(`[Relance Sender] Creating new wave ${newWaveId} with ${newTargets.length} targets`);

            for (const target of newTargets) {
                target.waveId = newWaveId;
                target.waveJoinedAt = newWaveDate;
                await target.save();
            }

            targetsToProcess = newTargets;
            console.log(`[Relance Sender] New wave ${newWaveId} created with ${newTargets.length} targets`);
        } else {
            // Get the waveId from existing active targets
            const currentWaveId = activeWaveTargets[0]?.waveId;
            console.log(`[Relance Sender] Continuing with active wave: ${currentWaveId}`);
        }

        console.log(`[Relance Sender] Processing ${targetsToProcess.length} targets...`);

        let totalSent = 0;
        let totalFailed = 0;
        let totalExited = 0;

        // Process targets in waves
        let currentWaveIndex = 0;
        let messagesInCurrentWave = 0;

        for (let i = 0; i < targetsToProcess.length; i++) {
            const target = targetsToProcess[i];
            try {
                const referrerId = target.referrerUserId.toString();
                const referralId = target.referralUserId.toString();
                const campaign = target.campaignId as any; // Campaign or null for default

                const campaignLabel = campaign ? `[Campaign:${campaign._id}]` : '[Default]';

                // Get referrer's config
                const config = await RelanceConfigModel.findOne({ userId: referrerId });
                if (!config) {
                    console.log(`${campaignLabel} No config found for referrer ${referrerId}, skipping target ${target._id}`);
                    continue;
                }

                // Check if sending is paused
                if (config.sendingPaused || !config.enabled) {
                    console.log(`${campaignLabel} Sending paused for referrer ${referrerId}, skipping target ${target._id}`);
                    continue;
                }

                // Verify referrer still has active relance subscription
                const hasRelance = await userServiceClient.hasRelanceSubscription(referrerId);
                if (!hasRelance) {
                    console.log(`${campaignLabel} Referrer ${referrerId} no longer has RELANCE subscription, exiting target ${target._id}`);
                    target.status = TargetStatus.COMPLETED;
                    target.exitReason = ExitReason.REFERRER_INACTIVE;
                    target.exitedLoopAt = new Date();
                    await target.save();

                    if (campaign) {
                        campaign.targetsExited += 1;
                        await campaign.save();
                    }

                    totalExited++;
                    continue;
                }

                // Check daily message limits
                if (config.messagesSentToday >= config.maxMessagesPerDay) {
                    console.log(`${campaignLabel} User ${referrerId} reached daily limit (${config.maxMessagesPerDay}), skipping`);
                    continue;
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
                    console.log(`${campaignLabel} Message already sent for day ${target.currentDay} to target ${target._id}, skipping to prevent duplicate`);

                    // Update nextMessageDue to tomorrow to prevent re-processing
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
                    // Use campaign custom messages
                    messageTemplate = campaign.customMessages.find((m: any) => m.dayNumber === target.currentDay);
                }

                if (!messageTemplate) {
                    // Use default message templates
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
                    totalFailed++;
                    continue;
                }

                // Get referrer user info
                const referrerInfo = await userServiceClient.getUserDetails(referrerId);
                if (!referrerInfo) {
                    console.log(`${campaignLabel} Could not fetch referrer info for ${referrerId}, skipping target ${target._id}`);
                    totalFailed++;
                    continue;
                }

                // Personalize message with variables
                const language = target.language || 'fr';
                let messageText = language === 'en' ? messageTemplate.messageTemplate.en : messageTemplate.messageTemplate.fr;

                // Replace variables
                messageText = messageText
                    .replace(/\{\{name\}\}/g, referralInfo.name || 'there')
                    .replace(/\{\{referrerName\}\}/g, referrerInfo.name || 'your referrer')
                    .replace(/\{\{day\}\}/g, target.currentDay.toString());

                // Check for email address
                const recipientEmail = referralInfo.email;
                if (!recipientEmail) {
                    console.log(`${campaignLabel} Referral ${referralId} has no email address, skipping target ${target._id}`);
                    totalFailed++;
                    continue;
                }

                // Send email
                const sendResult = await emailRelanceService.sendRelanceEmail(
                    recipientEmail,
                    referralInfo.name || 'Member',
                    referrerInfo.name || 'Your Referrer',
                    messageText,
                    target.currentDay,
                    messageTemplate.mediaUrls
                );

                if (sendResult.success) {
                    console.log(`${campaignLabel} ✓ Email sent to ${recipientEmail} (Day ${target.currentDay}) for target ${target._id}`);

                    // Update target
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
                        // Exit loop after 7 days
                        target.status = TargetStatus.COMPLETED;
                        target.exitReason = ExitReason.COMPLETED_7_DAYS;
                        target.exitedLoopAt = new Date();
                        console.log(`${campaignLabel} Target ${target._id} completed 7-day loop, exiting`);

                        if (campaign) {
                            campaign.targetsCompleted += 1;
                            await campaign.save();
                        }

                        totalExited++;
                    } else {
                        // Schedule next message (24 hours from now)
                        target.currentDay += 1;
                        const nextDue = new Date();
                        nextDue.setHours(nextDue.getHours() + 24);
                        target.nextMessageDue = nextDue;
                        console.log(`${campaignLabel} Target ${target._id} moved to day ${target.currentDay}, next message at ${nextDue.toISOString()}`);
                    }

                    await target.save();
                    totalSent++;

                } else {
                    console.error(`${campaignLabel} Failed to send email to ${recipientEmail} for target ${target._id}:`, sendResult.error);

                    // Log failed delivery
                    target.messagesDelivered.push({
                        day: target.currentDay,
                        sentAt: new Date(),
                        status: 'failed' as any,
                        errorMessage: sendResult.error
                    });
                    await target.save();

                    // Update campaign stats
                    if (campaign) {
                        campaign.messagesFailed += 1;
                        await campaign.save();
                    }

                    totalFailed++;
                }

                // Wave-based delay system with random jitter
                messagesInCurrentWave++;

                // Check if we need to move to the next wave
                const currentWave = WAVE_CONFIGS[currentWaveIndex] || WAVE_CONFIGS[WAVE_CONFIGS.length - 1];

                if (messagesInCurrentWave >= currentWave.messages) {
                    // Wave completed - apply pause if specified
                    if (currentWave.pauseAfter > 0) {
                        const pauseWithJitter = addJitter(currentWave.pauseAfter);
                        console.log(`[Relance Sender] Wave ${currentWaveIndex + 1} completed (${messagesInCurrentWave} messages). Pausing for ${Math.round(pauseWithJitter / 1000 / 60)} minutes...`);
                        await new Promise(resolve => setTimeout(resolve, pauseWithJitter));
                    }

                    // Move to next wave
                    currentWaveIndex++;
                    messagesInCurrentWave = 0;

                    if (currentWaveIndex < WAVE_CONFIGS.length) {
                        console.log(`[Relance Sender] Starting Wave ${currentWaveIndex + 1}...`);
                    }
                } else {
                    // Still in current wave - apply message delay
                    const delayWithJitter = addJitter(currentWave.delayBetween);
                    console.log(`[Relance Sender] Wave ${currentWaveIndex + 1}, message ${messagesInCurrentWave}/${currentWave.messages}. Waiting ${Math.round(delayWithJitter / 1000)} seconds before next message...`);
                    await new Promise(resolve => setTimeout(resolve, delayWithJitter));
                }

            } catch (targetError) {
                console.error(`[Relance Sender] Error processing target ${target._id}:`, targetError);
                totalFailed++;
            }
        }

        // Check for campaigns that should be completed
        await checkAndCompleteCampaigns();

        const duration = Date.now() - startTime;
        const durationMinutes = Math.round(duration / 1000 / 60);
        console.log(`[Relance Sender] Message sending job completed in ${durationMinutes} minutes`);
        console.log(`[Relance Sender] Summary: ${totalSent} sent, ${totalFailed} failed, ${totalExited} exited`);
        console.log(`[Relance Sender] Waves processed: ${currentWaveIndex + 1}/${WAVE_CONFIGS.length}`);

    } catch (error) {
        console.error('[Relance Sender] Fatal error in sender job:', error);
    }
}

/**
 * Check if any campaigns should be marked as completed
 * and resume default campaign if needed
 */
async function checkAndCompleteCampaigns() {
    try {
        // Find all active filtered campaigns
        const activeCampaigns = await CampaignModel.find({
            status: CampaignStatus.ACTIVE
        });

        for (const campaign of activeCampaigns) {
            // Count remaining active targets for this campaign
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
                    // Resume default campaign
                    const config = await RelanceConfigModel.findOne({ userId: campaign.userId });
                    if (config && config.defaultCampaignPaused) {
                        config.defaultCampaignPaused = false;
                        await config.save();
                        console.log(`[Relance Sender] Resumed default campaign for user ${campaign.userId.toString()} (last filtered campaign completed)`);
                    }
                }
            }
        }

    } catch (error) {
        console.error('[Relance Sender] Error checking campaign completion:', error);
    }
}

export function startRelanceSenderJob() {
    console.log('[Relance Sender] Scheduling email sender job - runs immediately on startup, then every 6 hours');
    console.log('[Relance Sender] Wave-based email sending configured (60 messages/day max):');
    WAVE_CONFIGS.forEach((wave, index) => {
        const delayMin = Math.round(wave.delayBetween / 1000 / 60);
        const pauseMin = Math.round(wave.pauseAfter / 1000 / 60);
        if (pauseMin > 0) {
            console.log(`  Wave ${index + 1}: ${wave.messages} messages, ${delayMin}min between, ${pauseMin}min pause after`);
        } else {
            console.log(`  Wave ${index + 1}: ${wave.messages} messages, ${delayMin}min between (final wave)`);
        }
    });

    // Run immediately on startup for testing
    runMessageSendingJob();

    // Run every 6 hours (at 00:00, 06:00, 12:00, 18:00)
    cron.schedule('0 */6 * * *', runMessageSendingJob);

    console.log('[Relance Sender] Job scheduled successfully');

    // Also schedule daily reset of message counters (runs at midnight)
    cron.schedule('0 0 * * *', async () => {
        console.log('[Relance Sender] Resetting daily message counters...');
        try {
            // Reset config counters
            const configResult = await RelanceConfigModel.updateMany(
                {},
                {
                    $set: {
                        messagesSentToday: 0,
                        lastResetDate: new Date()
                    }
                }
            );

            // Reset campaign counters
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
