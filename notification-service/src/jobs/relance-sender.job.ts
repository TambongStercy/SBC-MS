import cron from 'node-cron';
import RelanceConfigModel, { WhatsAppStatus } from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import CampaignModel, { CampaignStatus } from '../database/models/relance-campaign.model';
import { whatsappRelanceService } from '../services/whatsapp.relance.service';
import { userServiceClient } from '../services/clients/user.service.client';

// Track disconnected referrers to avoid log spam
const disconnectedWarnings = new Map<string, number>();
const WARNING_COOLDOWN_MS = 10 * 60 * 1000; // Only log once every 10 minutes per referrer

/**
 * Wave Configuration
 * Based on client specifications for natural, safe WhatsApp message delivery
 *
 * New Strategy (50 messages/day):
 * - Wave 1: 10 messages, 3min between, 30min pause after
 * - Wave 2: 10 messages, 4min between, 1h pause after
 * - Wave 3: 10 messages, 5min between, 1h30 pause after
 * - Wave 4: 10 messages, 6min between, 2h pause after
 * - Wave 5: 10 messages, 7min between (final wave)
 */
interface WaveConfig {
    messages: number;           // Number of messages in this wave
    delayBetween: number;       // Milliseconds between messages in this wave
    pauseAfter: number;         // Milliseconds to pause after completing this wave
}

const WAVE_CONFIGS: WaveConfig[] = [
    { messages: 10, delayBetween: 3 * 60 * 1000, pauseAfter: 30 * 60 * 1000 },    // Wave 1: 10 msgs, 3min between, 30min pause
    { messages: 10, delayBetween: 4 * 60 * 1000, pauseAfter: 60 * 60 * 1000 },    // Wave 2: 10 msgs, 4min between, 1h pause
    { messages: 10, delayBetween: 5 * 60 * 1000, pauseAfter: 90 * 60 * 1000 },    // Wave 3: 10 msgs, 5min between, 1h30 pause
    { messages: 10, delayBetween: 6 * 60 * 1000, pauseAfter: 120 * 60 * 1000 },   // Wave 4: 10 msgs, 6min between, 2h pause
    { messages: 10, delayBetween: 7 * 60 * 1000, pauseAfter: 0 }                  // Wave 5: 10 msgs, 7min between, no pause (final)
];

/**
 * Add random jitter to delay for more natural timing
 * Jitter: ±30 seconds
 */
function addJitter(baseDelay: number): number {
    const jitterRange = 30 * 1000; // ±30 seconds
    const jitter = (Math.random() - 0.5) * 2 * jitterRange; // Random between -30s and +30s
    return Math.max(1000, baseDelay + jitter); // Minimum 1 second
}

/**
 * Message Sender Cron Job
 * Runs immediately on startup (for testing), then every 6 hours
 *
 * NEW Wave-Based Process:
 * 1. Find all active targets whose nextMessageDue time has passed
 * 2. Process targets in waves with varying delays and strategic pauses
 * 3. Get the message template (campaign custom or default)
 * 4. Send personalized WhatsApp message with natural timing
 * 5. Update target progress and campaign stats
 * 6. Check if campaign should be completed
 */

async function runMessageSendingJob() {
    console.log('[Relance Sender] Starting message sending job...');
    const startTime = Date.now();

    try {
        const now = new Date();

        // Find all active targets that need a message sent
        const targetsToProcess = await RelanceTargetModel.find({
            status: TargetStatus.ACTIVE,
            nextMessageDue: { $lte: now }
        }).populate('campaignId');

        console.log(`[Relance Sender] Found ${targetsToProcess.length} targets ready for messages`);

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

                // Check WhatsApp connection status
                if (config.whatsappStatus !== WhatsAppStatus.CONNECTED) {
                    // Throttle disconnected warnings to avoid log spam
                    const lastWarning = disconnectedWarnings.get(referrerId) || 0;
                    const now = Date.now();

                    if (now - lastWarning > WARNING_COOLDOWN_MS) {
                        console.log(`${campaignLabel} WhatsApp not connected for referrer ${referrerId} (status: ${config.whatsappStatus}), skipping messages`);
                        disconnectedWarnings.set(referrerId, now);
                    }
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

                // Initialize WhatsApp client
                const client = await whatsappRelanceService.initializeClient(referrerId);
                if (!client) {
                    console.log(`${campaignLabel} Could not initialize WhatsApp client for ${referrerId}, skipping target ${target._id}`);
                    totalFailed++;
                    continue;
                }

                // Send message
                const phoneNumber = referralInfo.phoneNumber;
                if (!phoneNumber) {
                    console.log(`${campaignLabel} Referral ${referralId} has no phone number, skipping target ${target._id}`);
                    totalFailed++;
                    continue;
                }

                const sendResult = await whatsappRelanceService.sendMessage(
                    client,
                    phoneNumber,
                    messageText,
                    messageTemplate.mediaUrls
                );

                if (sendResult.success) {
                    console.log(`${campaignLabel} ✓ Message sent to ${phoneNumber} (Day ${target.currentDay}) for target ${target._id}`);

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
                    console.error(`${campaignLabel} Failed to send message to ${phoneNumber} for target ${target._id}:`, sendResult.error);

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

                // Keep client connected for future messages (no need to disconnect)
                // The client will auto-disconnect on connection issues or manual disconnect

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
    console.log('[Relance Sender] Scheduling sender job - runs immediately on startup (for testing), then every 6 hours');
    console.log('[Relance Sender] Wave-based sending configured (50 messages/day max):');
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
