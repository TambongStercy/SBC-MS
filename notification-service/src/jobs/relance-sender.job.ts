import cron from 'node-cron';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import RelanceSmsTemplateModel from '../database/models/relance-sms-template.model';
import CampaignModel, { CampaignStatus } from '../database/models/relance-campaign.model';
import { emailRelanceService } from '../services/email.relance.service';
import { smsService } from '../services/sms.service';
import { emailService } from '../services/email.service';
import { userServiceClient } from '../services/clients/user.service.client';

// CM country code — only CM numbers qualify for SMS relance
const CM_PHONE_PREFIX = '237';

function isCmNumber(phone?: string): boolean {
    if (!phone) return false;
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith(CM_PHONE_PREFIX);
}

function formatCmNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return `+${digits}`;
}

// Low-balance thresholds — trigger one notification when crossing below
const EMAIL_LOW_BALANCE_THRESHOLD = 50;
const SMS_LOW_BALANCE_THRESHOLD = 20;

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
const MAX_RETRIES_PER_DAY = 3; // Max send attempts per day before skipping to next day

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

            // Check if sending is paused - break to stop ALL targets for this user
            if (config.sendingPaused) {
                console.log(`${campaignLabel} Sending paused for referrer ${referrerId}, stopping all targets`);
                break;
            }
            const isDefaultTarget = !campaign;
            if (isDefaultTarget && !config.enabled) {
                console.log(`${campaignLabel} Default relance disabled for referrer ${referrerId}, skipping default target ${target._id}`);
                continue; // continue here since campaign targets may still need processing
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

            // Check if max retries exceeded for this day
            const failedAttemptsForDay = target.messagesDelivered.filter((msg: any) => {
                return msg.day === target.currentDay && msg.status === 'failed';
            }).length;

            if (failedAttemptsForDay >= MAX_RETRIES_PER_DAY) {
                console.log(`${campaignLabel} Max retries (${MAX_RETRIES_PER_DAY}) reached for day ${target.currentDay} of target ${target._id}, skipping to next day`);

                if (target.currentDay >= 7) {
                    target.status = TargetStatus.COMPLETED;
                    target.exitReason = ExitReason.COMPLETED_7_DAYS;
                    target.exitedLoopAt = new Date();
                    console.log(`${campaignLabel} Target ${target._id} completed 7-day loop (last day failed)`);

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

            // Check bounce suppression list — skip permanently bounced addresses
            const isSuppressed = await RelanceBounceSuppressionModel.exists({ email: recipientEmail.toLowerCase() });
            if (isSuppressed) {
                console.log(`${campaignLabel} Email ${recipientEmail} is suppressed (hard bounce), exiting target ${target._id}`);
                target.status = TargetStatus.COMPLETED;
                target.exitReason = ExitReason.EMAIL_SUPPRESSED;
                target.exitedLoopAt = new Date();
                await target.save();
                exited++;
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

                // Extract provider message ID
                let sendGridMessageId: string | undefined;
                if (sendResult.messageId) {
                    sendGridMessageId = sendResult.messageId.replace(/<|>/g, '').split('@')[0];
                }

                target.messagesDelivered.push({
                    day: target.currentDay,
                    channel: 'email',
                    sentAt: new Date(),
                    status: 'delivered' as any,
                    sendGridMessageId
                });
                target.lastMessageSentAt = new Date();

                // Deduct email credit
                config.emailBalance = Math.max(0, config.emailBalance - 1);
                config.messagesSentToday = (config.messagesSentToday || 0) + 1;

                // Low-balance alert (fire-and-forget)
                if (config.emailBalance === EMAIL_LOW_BALANCE_THRESHOLD) {
                    const referrerInfo = await userServiceClient.getUserDetails(referrerId);
                    if (referrerInfo?.email) {
                        emailService.sendLowBalanceAlert(referrerInfo.email, referrerInfo.name || '', 'email', config.emailBalance)
                            .catch(err => console.error('[Relance Sender] Low-balance alert failed:', err));
                    }
                } else if (config.emailBalance === 0) {
                    const referrerInfo = await userServiceClient.getUserDetails(referrerId);
                    if (referrerInfo?.email) {
                        emailService.sendCreditsExhaustedAlert(referrerInfo.email, referrerInfo.name || '', 'email')
                            .catch(err => console.error('[Relance Sender] Credits-exhausted alert failed:', err));
                    }
                }

                // SMS send (same target, same day) — CM numbers only
                if (config.smsEnabled && config.smsBalance > 0) {
                    const phone: string | undefined = referralInfo.phoneNumber;
                    if (phone && isCmNumber(phone)) {
                        const smsTemplate = await RelanceSmsTemplateModel.findOne({
                            type: isDefaultTarget ? 'auto' : 'manual',
                            dayNumber: target.currentDay,
                            active: true
                        });
                        if (smsTemplate) {
                            const userLink = (config.smsLinks || []).find((l: any) =>
                                l.type === (isDefaultTarget ? 'auto' : 'manual') &&
                                l.dayNumber === target.currentDay
                            );
                            const smsText = smsTemplate.templateText.replace(/\{\{link\}\}/g, userLink?.link || '');
                            const smsSent = await smsService.sendSms({ to: formatCmNumber(phone!), body: smsText });
                            if (smsSent) {
                                config.smsBalance = Math.max(0, config.smsBalance - 1);
                                target.messagesDelivered.push({
                                    day: target.currentDay,
                                    channel: 'sms',
                                    sentAt: new Date(),
                                    status: 'delivered' as any
                                });
                                if (config.smsBalance === SMS_LOW_BALANCE_THRESHOLD) {
                                    const referrerInfo2 = await userServiceClient.getUserDetails(referrerId);
                                    if (referrerInfo2?.email) {
                                        emailService.sendLowBalanceAlert(referrerInfo2.email, referrerInfo2.name || '', 'sms', config.smsBalance)
                                            .catch(() => {});
                                    }
                                }
                            }
                        }
                    }
                }

                await config.save();

                // Update campaign stats
                if (campaign) {
                    campaign.messagesSent += 1;
                    campaign.messagesDelivered += 1;
                    await campaign.save();
                }

                // Advance day: J1-J6 → next day in 24h; J7 → completed
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

                // Count how many times we've failed for this day (including this attempt)
                const totalFailsForDay = target.messagesDelivered.filter((msg: any) => {
                    return msg.day === target.currentDay && msg.status === 'failed';
                }).length;

                if (totalFailsForDay >= MAX_RETRIES_PER_DAY) {
                    // Max retries reached, skip to next day
                    console.log(`${campaignLabel} Max retries (${MAX_RETRIES_PER_DAY}) reached for day ${target.currentDay}, moving to next day`);
                    if (target.currentDay >= 7) {
                        target.status = TargetStatus.COMPLETED;
                        target.exitReason = ExitReason.COMPLETED_7_DAYS;
                        target.exitedLoopAt = new Date();

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
                } else {
                    // Retry in 1 hour instead of 15 minutes
                    const retryDue = new Date();
                    retryDue.setHours(retryDue.getHours() + 1);
                    target.nextMessageDue = retryDue;
                    console.log(`${campaignLabel} Will retry day ${target.currentDay} in 1 hour (attempt ${totalFailsForDay}/${MAX_RETRIES_PER_DAY})`);
                }

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
 * Job lock to prevent overlapping runs.
 * Without this, the 15-minute cron can start a new run while a previous one
 * is still processing thousands of targets (2s delay each = hours),
 * causing massive duplicate sends.
 */
let isJobRunning = false;

/**
 * Main Message Sending Job
 * Groups targets by user and processes each user in parallel
 */
async function runMessageSendingJob() {
    if (isJobRunning) {
        console.log('[Relance Sender] Previous job still running, skipping this cycle.');
        return;
    }

    isJobRunning = true;
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

                // Credits are the access gate — no subscription check needed
                if (config.emailBalance <= 0 && config.smsBalance <= 0) {
                    console.log(`[Relance Sender] User ${referrerId} has no credits (email: ${config.emailBalance}, sms: ${config.smsBalance}), skipping`);
                    return { userId: referrerId, sent: 0, failed: 0, exited: 0 };
                }

                console.log(`[Relance Sender] [User:${referrerId.slice(-6)}] Processing ${userTargets.length} targets (email: ${config.emailBalance}, sms: ${config.smsBalance})...`);
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
    } finally {
        isJobRunning = false;
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

                // Default relance is independent — it runs continuously as long as the user has it enabled.
                // Only filtered/custom campaigns have a finite lifecycle and stop here.
                console.log(`[Relance Sender] Filtered campaign ${campaign._id} completed for user ${campaign.userId.toString()}.`);
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

}
