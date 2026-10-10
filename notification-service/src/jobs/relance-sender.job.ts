import cron from 'node-cron';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import { pushCreditsExhausted, pushCreditsLow, pushFilleulPaid } from '../services/relance-alerts.service';
import RelanceMessageModel from '../database/models/relance-message.model';
import RelanceSmsTemplateModel from '../database/models/relance-sms-template.model';
import CampaignModel, { CampaignStatus } from '../database/models/relance-campaign.model';
import { emailRelanceService } from '../services/email.relance.service';
import { smsService } from '../services/sms.service';
import { emailService } from '../services/email.service';
import { msToNextMinute } from '../services/send-budget.service';
import { userServiceClient } from '../services/clients/user.service.client';

// CM country code — only CM numbers qualify for SMS relance
const CM_PHONE_PREFIX = '237';

// user-service returns phoneNumber as a NUMBER for some accounts. These helpers
// once called phone.replace() on it, which threw after the email had gone out
// and before the target was saved, so the same email was resent every run
// (up to 35 times to one filleul, 2026-10-08 → 10-10).
function isCmNumber(phone?: string | number | null): boolean {
    if (phone === undefined || phone === null || phone === '') return false;
    return String(phone).replace(/\D/g, '').startsWith(CM_PHONE_PREFIX);
}

function formatCmNumber(phone: string | number): string {
    return `+${String(phone).replace(/\D/g, '')}`;
}

// SMS relance is reserved for non-subscribed users — once a referral has
// CLASSIQUE or CIBLE, the SMS branch is skipped (emails still go through).
const SUBSCRIPTION_TYPES_BLOCKING_SMS = ['CLASSIQUE', 'CIBLE'];

async function isSmsBlockedBySubscription(referralId: string): Promise<boolean> {
    try {
        const types = await userServiceClient.getActiveSubscriptionTypes(referralId);
        return types.some(t => SUBSCRIPTION_TYPES_BLOCKING_SMS.includes(t));
    } catch {
        // Fail-open is risky here (we'd send SMS to subscribed users), so on
        // error we treat as blocked. Worst case: a transient user-service
        // hiccup skips one SMS — they retry on the next cron tick.
        return true;
    }
}

/** True only when user-service positively reports a paid plan. */
async function referralHasPaid(referralId: string): Promise<boolean> {
    try {
        const types = await userServiceClient.getActiveSubscriptionTypes(referralId);
        return types.some(t => SUBSCRIPTION_TYPES_BLOCKING_SMS.includes(t));
    } catch {
        return false;
    }
}

// Low-balance thresholds — trigger one notification when crossing below
const EMAIL_LOW_BALANCE_THRESHOLD = 50;
const SMS_LOW_BALANCE_THRESHOLD = 20;

type CreditChannel = 'email' | 'sms';
const balanceField = (channel: CreditChannel) => (channel === 'email' ? 'emailBalance' : 'smsBalance');

/**
 * Starts a new day's email count. lastResetDate was written once at creation and
 * never again, so messagesSentToday only ever grew; with the daily limit now
 * enforced it would have stopped a parrain for good after one busy day.
 * Days are counted in UTC.
 */
export async function resetDailyCountIfNewDay(config: any, now: Date = new Date()): Promise<void> {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const updated: any = await RelanceConfigModel.findOneAndUpdate(
        { _id: config._id, $or: [{ lastResetDate: { $lt: startOfToday } }, { lastResetDate: null }] },
        { $set: { messagesSentToday: 0, lastResetDate: now } },
        { new: true, projection: { messagesSentToday: 1, lastResetDate: 1 } },
    ).lean();
    if (updated) {
        config.messagesSentToday = 0;
        config.lastResetDate = updated.lastResetDate;
    }
}

/**
 * Takes one credit before a message is sent, atomically. Returns false when
 * none is left, and the message must then not be sent.
 *
 * Credits used to be decremented on the in-memory config and written back
 * whole with `config.save()` at the end of a target. A pack credited while a
 * run was in progress (creditRelancePack does a `$inc`) was then overwritten by
 * the stale in-memory value and lost. The regular path also sent emails without
 * checking the email balance at all — any SMS credit got a user past the gate.
 *
 * The in-memory copy is kept in step so later checks in the same run and the
 * low-balance alerts see the real figure. It is never saved back.
 */
/**
 * After an email credit is spent: warn the parrain at the low mark and when
 * it runs out, by email and push. The J0 path used to send no warning at all,
 * so a parrain whose last credit went on a welcome email was never told.
 */
async function alertOnEmailCredit(referrerId: string, config: any): Promise<void> {
    const remaining = config.emailBalance;
    if (remaining !== EMAIL_LOW_BALANCE_THRESHOLD && remaining !== 0) return;
    if (remaining === 0) pushCreditsExhausted(referrerId);
    else pushCreditsLow(referrerId, remaining);
    const referrerInfo = await userServiceClient.getUserDetails(referrerId);
    if (!referrerInfo?.email) return;
    const sent = remaining === 0
        ? emailService.sendCreditsExhaustedAlert(referrerInfo.email, referrerInfo.name || '', 'email')
        : emailService.sendLowBalanceAlert(referrerInfo.email, referrerInfo.name || '', 'email', remaining);
    sent.catch(err => console.error('[Relance Sender] Credit alert failed:', err));
}

export async function reserveRelanceCredit(config: any, channel: CreditChannel): Promise<boolean> {
    const field = balanceField(channel);
    const inc: Record<string, number> = { [field]: -1 };
    const filter: Record<string, any> = { _id: config._id, [field]: { $gt: 0 } };
    // A count for the admin, not a limit. The per-parrain daily limit is gone
    // (2026-10-07): the shared per-minute budget on the mail server
    // (send-budget.service) is what protects OTPs now.
    if (channel === 'email') inc.messagesSentToday = 1;
    const updated: any = await RelanceConfigModel.findOneAndUpdate(
        filter,
        { $inc: inc },
        { new: true, projection: { emailBalance: 1, smsBalance: 1, messagesSentToday: 1 } },
    ).lean();
    if (!updated) {
        const fresh: any = await RelanceConfigModel.findById(config._id)
            .select('emailBalance smsBalance messagesSentToday').lean();
        if (fresh) {
            config[field] = fresh[field] ?? 0;
            config.messagesSentToday = fresh.messagesSentToday ?? 0;
        }
        return false;
    }
    config[field] = updated[field];
    config.messagesSentToday = updated.messagesSentToday;
    return true;
}

/** Gives back a credit reserved for a message that then failed to send. */
export async function refundRelanceCredit(config: any, channel: CreditChannel): Promise<void> {
    const field = balanceField(channel);
    const inc: Record<string, number> = { [field]: 1 };
    if (channel === 'email') inc.messagesSentToday = -1;
    const updated: any = await RelanceConfigModel.findOneAndUpdate(
        { _id: config._id },
        { $inc: inc },
        { new: true, projection: { emailBalance: 1, smsBalance: 1, messagesSentToday: 1 } },
    ).lean();
    if (updated) {
        config[field] = updated[field];
        config.messagesSentToday = updated.messagesSentToday;
    }
}

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
const EMAIL_DELAY_MS = Number(process.env.RELANCE_EMAIL_DELAY_MS ?? 2000); // 2 seconds between emails per user (overridable for tests)

/**
 * Relance only sends when the mail server has room left after OTP and other
 * email (send-budget.service). A run waits for room minute by minute, up to
 * this many minutes — one cron cycle — then leaves the rest to the next run.
 */
const SPARE_WAIT_MINUTES = Number(process.env.RELANCE_SPARE_WAIT_MINUTES ?? 14);

type RelanceSendResult = Awaited<ReturnType<typeof emailRelanceService.sendRelanceEmail>>;

async function sendWhenSpare(send: () => Promise<RelanceSendResult>): Promise<RelanceSendResult> {
    let result = await send();
    for (let i = 0; result.deferred && i < SPARE_WAIT_MINUTES; i++) {
        await new Promise(r => setTimeout(r, msToNextMinute() + Math.floor(Math.random() * 2000)));
        result = await send();
    }
    return result;
}
const MAX_RETRIES_PER_DAY = 3; // Max send attempts per day before skipping to next day

/**
 * Process a single user's targets
 * Each user runs independently with their own pacing
 */
export async function processUserTargets(
    referrerId: string,
    targets: any[],
    config: any
): Promise<{ sent: number; failed: number; exited: number }> {
    let sent = 0;
    let failed = 0;
    let exited = 0;
    // Set when the mail server had no room for this run: the remaining targets
    // stay due, untouched, and go out on a later run.
    let outOfCapacity = false;

    for (let i = 0; i < targets.length; i++) {
        if (outOfCapacity) break;
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
            // Nothing can go out for this parrain right now (no email credit and no
            // SMS available): stop here. Carrying on would only spend user-service
            // lookups on every waiting filleul, every run.
            const canEmail = (config.emailBalance ?? 0) > 0;
            const canSms = !!config.smsEnabled && (config.smsBalance ?? 0) > 0;
            if (!canEmail && !canSms) {
                console.log(`[Relance Sender] [User:${referrerId.slice(-6)}] out of credits; ${targets.length - i} target(s) wait for the next run`);
                break;
            }
            const isDefaultTarget = !campaign;
            if (isDefaultTarget && !config.enabled) {
                console.log(`${campaignLabel} Default relance disabled for referrer ${referrerId}, skipping default target ${target._id}`);
                continue; // continue here since campaign targets may still need processing
            }
            // A campaign sends only while it is ACTIVE. Pausing used to stop new
            // filleuls joining but let everyone already in it keep receiving messages;
            // the target now waits where it is and resumes with the campaign.
            if (campaign && campaign.status !== CampaignStatus.ACTIVE) {
                console.log(`${campaignLabel} campaign is ${campaign.status}; holding target ${target._id}`);
                continue;
            }
            // Relance des nouveaux exists to get a new filleul to pay. Payment is
            // supposed to exit them (internal/exit-user), but the activation-balance
            // path never calls it, and only the SMS branch used to check — so a
            // filleul who had already paid could keep getting "you haven't paid"
            // emails. Exit only on a positive answer: an unreachable user-service
            // returns no subscriptions, and wrongly exiting an unpaid filleul would
            // be permanent. Campaigns are left to their own filter, which may
            // target subscribers on purpose.
            if (isDefaultTarget && await referralHasPaid(referralId)) {
                console.log(`${campaignLabel} filleul ${referralId} has paid; leaving relance`);
                target.status = TargetStatus.COMPLETED;
                target.exitReason = ExitReason.PAID;
                target.exitedLoopAt = new Date();
                await target.save();
                pushFilleulPaid(referrerId, String(referralId));
                exited++;
                continue;
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

            // ───── J0 fast path (default targets only) ─────
            // Default (auto) targets start at currentDay = 0 = J0, the 15-min teaser.
            // Per Rufus's spec, the FIRST email (J1) and FIRST SMS (J0) fire together
            // at T+15min — not 24h apart. So at currentDay=0 we attempt BOTH the SMS
            // J0 teaser AND the Email J1 welcome.
            //
            // After J0, the regular daily cadence kicks in but with SMS lagging email
            // by one template-day for default targets:
            //   currentDay=1 → SMS J1 + Email J2
            //   currentDay=2 → SMS J2 + Email J3
            //   ...
            //   currentDay=6 → SMS J6 + Email J7
            //   currentDay=7 → SMS J7 only (no email — out of email templates) → complete
            //
            // Manual campaigns enrol at currentDay=1 and use the same dayNumber for
            // both email and SMS (no offset, no J0).
            //
            // Best-effort at J0: no retry on J0 — we always advance to Day 1.
            // Manual campaigns landing here (shouldn't happen) get pushed forward.
            if (target.currentDay === 0) {
                if (!isDefaultTarget) {
                    target.currentDay = 1;
                    const nextDue = new Date();
                    nextDue.setHours(nextDue.getHours() + 24);
                    target.nextMessageDue = nextDue;
                    await target.save();
                    continue;
                }

                const referralInfo = await userServiceClient.getUserDetails(referralId);
                if (!referralInfo) {
                    console.log(`${campaignLabel} J0: could not fetch referral info for ${referralId}, skipping`);
                    failed++;
                    continue;
                }

                // Set when the welcome email was ready to go but no credit (or no
                // allowance left today) was available. J0 used to advance regardless,
                // so the filleul silently lost their first email for good.
                let emailHeld = false;
                let j0SmsSent = false;

                // ─── J1 EMAIL (welcome) ───
                const recipientEmail = referralInfo.email;
                if (recipientEmail) {
                    const isSuppressed = await RelanceBounceSuppressionModel.exists({ email: recipientEmail.toLowerCase() });
                    if (isSuppressed) {
                        console.log(`${campaignLabel} J0: email ${recipientEmail} suppressed, exiting target`);
                        target.status = TargetStatus.COMPLETED;
                        target.exitReason = ExitReason.EMAIL_SUPPRESSED;
                        target.exitedLoopAt = new Date();
                        await target.save();
                        exited++;
                        continue;
                    }

                    const emailTemplate = await RelanceMessageModel.findOne({ dayNumber: 1, active: true });
                    const emailReserved = !!emailTemplate && await reserveRelanceCredit(config, 'email');
                    if (emailTemplate && !emailReserved) emailHeld = true;
                    if (emailTemplate && emailReserved) {
                        const referrerInfo = await userServiceClient.getUserDetails(referrerId);
                        const language = target.language || 'fr';
                        let messageText = language === 'en' ? emailTemplate.messageTemplate.en : emailTemplate.messageTemplate.fr;
                        messageText = messageText
                            .replace(/\{\{name\}\}/g, referralInfo.name || 'there')
                            .replace(/\{\{referrerName\}\}/g, referrerInfo?.name || 'your referrer')
                            .replace(/\{\{day\}\}/g, '1');
                        const sendResult = await sendWhenSpare(() => emailRelanceService.sendRelanceEmail(
                            recipientEmail,
                            referralInfo.name || 'Member',
                            referrerInfo?.name || 'Your Referrer',
                            messageText,
                            1,
                            emailTemplate.mediaUrls,
                            emailTemplate.buttons,
                            emailTemplate.subject
                        ));
                        if (sendResult.deferred) {
                            // No room on the mail server: the welcome waits, uncharged.
                            await refundRelanceCredit(config, 'email');
                            emailHeld = true;
                            outOfCapacity = true;
                            console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] J0: no spare sending capacity; ${recipientEmail} waits for the next run`);
                        } else if (sendResult.success) {
                            let sendGridMessageId: string | undefined;
                            if (sendResult.messageId) {
                                sendGridMessageId = sendResult.messageId.replace(/<|>/g, '').split('@')[0];
                            }
                            target.messagesDelivered.push({
                                day: 0,
                                channel: 'email',
                                sentAt: new Date(),
                                status: 'delivered' as any,
                                sendGridMessageId
                            });
                            target.lastMessageSentAt = new Date();
                            console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] J0: J1 email sent to ${recipientEmail}`);
                            await alertOnEmailCredit(referrerId, config);
                        } else {
                            await refundRelanceCredit(config, 'email');
                            console.error(`${campaignLabel} J0: email send failed for ${recipientEmail}: ${sendResult.error}`);
                        }
                    }
                }

                // ─── J0 SMS (teaser) ───
                const phone: string | number | undefined = referralInfo.phoneNumber;
                // An SMS problem must never stop the email above from being recorded:
                // a throw here used to skip target.save(), so the email went out again
                // on every run.
                try {
                    if (config.smsEnabled && config.smsBalance > 0 && phone && isCmNumber(phone)) {
                        if (await isSmsBlockedBySubscription(referralId)) {
                            console.log(`${campaignLabel} J0: skipping SMS for ${referralId} — has CLASSIQUE/CIBLE subscription`);
                        } else {
                            const smsTemplate = await RelanceSmsTemplateModel.findOne({
                                type: 'auto',
                                dayNumber: 0,
                                active: true
                            });
                            if (smsTemplate && await reserveRelanceCredit(config, 'sms')) {
                                const userLink = (config.smsLinks || []).find((l: any) =>
                                    l.type === 'auto' && l.dayNumber === 0
                                );
                                const smsText = smsTemplate.templateText.replace(/\{\{link\}\}/g, userLink?.link || '');
                                const smsSent = await smsService.sendSms({ to: formatCmNumber(phone), body: smsText });
                                if (!smsSent) await refundRelanceCredit(config, 'sms');
                                if (smsSent) {
                                    target.messagesDelivered.push({
                                        day: 0,
                                        channel: 'sms',
                                        sentAt: new Date(),
                                        status: 'delivered' as any,
                                    });
                                    target.lastMessageSentAt = new Date();
                                    if (config.smsBalance === SMS_LOW_BALANCE_THRESHOLD) {
                                        const referrerInfo = await userServiceClient.getUserDetails(referrerId);
                                        if (referrerInfo?.email) {
                                            emailService.sendLowBalanceAlert(
                                                referrerInfo.email,
                                                referrerInfo.name || '',
                                                'sms',
                                                config.smsBalance
                                            ).catch(() => { });
                                        }
                                    }
                                    j0SmsSent = true;
                                    console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] J0 SMS sent to ${phone}`);
                                }
                            }
                        }
                    }
                } catch (smsErr: any) {
                    console.error(`${campaignLabel} J0 SMS step failed for target ${target._id}: ${smsErr?.message}`);
                }

                // Nothing went out only because of credit or sending capacity: keep
                // the filleul at J0 so the welcome email still goes when there is room.
                if (emailHeld && !j0SmsSent) {
                    console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] J0 held for ${referralId} — no email credit or no spare sending capacity`);
                    continue;
                }

                // Credits were already taken atomically per message; no config.save()
                // here, which is what used to overwrite a concurrent pack credit.
                sent++;

                // Advance J0 → Day 1 (best-effort, no retry on a provider failure)
                target.currentDay = 1;
                const nextDue = new Date();
                nextDue.setHours(nextDue.getHours() + 24);
                target.nextMessageDue = nextDue;
                await target.save();
                continue;
            }

            // ───── J7 SMS-only fast path (default targets only) ─────
            // Default targets at currentDay=7 send the final SMS (J7) but no email
            // (the email sequence ended at J7 sent at currentDay=6). Loop completes after.
            if (isDefaultTarget && target.currentDay === 7) {
                const referralInfo = await userServiceClient.getUserDetails(referralId);
                const phone: string | number | undefined = referralInfo?.phoneNumber;
                if (config.smsEnabled && config.smsBalance > 0 && phone && isCmNumber(phone)) {
                    if (await isSmsBlockedBySubscription(referralId)) {
                        console.log(`${campaignLabel} J7: skipping SMS for ${referralId} — has CLASSIQUE/CIBLE subscription`);
                    } else {
                        const smsTemplate = await RelanceSmsTemplateModel.findOne({
                            type: 'auto', dayNumber: 7, active: true
                        });
                        if (smsTemplate && await reserveRelanceCredit(config, 'sms')) {
                            const userLink = (config.smsLinks || []).find((l: any) =>
                                l.type === 'auto' && l.dayNumber === 7
                            );
                            const smsText = smsTemplate.templateText.replace(/\{\{link\}\}/g, userLink?.link || '');
                            const smsSent = await smsService.sendSms({ to: formatCmNumber(phone), body: smsText });
                            if (!smsSent) await refundRelanceCredit(config, 'sms');
                            if (smsSent) {
                                target.messagesDelivered.push({
                                    day: 7,
                                    channel: 'sms',
                                    sentAt: new Date(),
                                    status: 'delivered' as any,
                                });
                                target.lastMessageSentAt = new Date();
                                console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] J7 SMS sent to ${phone}`);
                            }
                        }
                    }
                }

                target.status = TargetStatus.COMPLETED;
                target.exitReason = ExitReason.COMPLETED_7_DAYS;
                target.exitedLoopAt = new Date();
                await target.save();
                if (campaign) { campaign.targetsCompleted += 1; await campaign.save(); }
                exited++;
                continue;
            }

            // ───── Day-number resolution (default targets are offset by 1) ─────
            // Default targets: at currentDay=N (1..6), send Email J(N+1) and SMS J(N).
            // Manual campaigns: at currentDay=N (1..7), send Email J(N) and SMS J(N) — same.
            // SMS dayNumber stays as target.currentDay (used in the SMS block below).
            const emailDayNumber = isDefaultTarget ? target.currentDay + 1 : target.currentDay;

            // Get message template (campaign custom or default)
            let messageTemplate: any = null;

            if (campaign && campaign.customMessages && campaign.customMessages.length > 0) {
                messageTemplate = campaign.customMessages.find((m: any) => m.dayNumber === emailDayNumber);
            }

            if (!messageTemplate) {
                messageTemplate = await RelanceMessageModel.findOne({
                    dayNumber: emailDayNumber,
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
                .replace(/\{\{day\}\}/g, emailDayNumber.toString());

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

            // No email credit: leave the target where it is — it is picked up again
            // on the next run once the parrain has credits. Never send unpaid.
            if (!(await reserveRelanceCredit(config, 'email'))) {
                console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] no email credit left; target ${target._id} waits`);
                continue;
            }

            // Send email (use emailDayNumber for the actual template day; for default
            // targets this is currentDay+1, for manual it equals currentDay)
            const sendResult = await sendWhenSpare(() => emailRelanceService.sendRelanceEmail(
                recipientEmail,
                referralInfo.name || 'Member',
                referrerInfo.name || 'Your Referrer',
                messageText,
                emailDayNumber,
                messageTemplate.mediaUrls,
                messageTemplate.buttons,
                messageTemplate.subject
            ));

            if (sendResult.deferred) {
                // No room on the mail server: not a failure, nothing charged, the
                // target stays due as it is. The rest of this parrain's run waits too.
                await refundRelanceCredit(config, 'email');
                outOfCapacity = true;
                console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] no spare sending capacity; remaining targets wait for the next run`);
                break;
            }

            if (sendResult.success) {
                console.log(`${campaignLabel} [User:${referrerId.slice(-6)}] Email J${emailDayNumber} sent to ${recipientEmail} (currentDay=${target.currentDay})`);

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

                // The email credit was reserved before sending (reserveRelanceCredit).

                await alertOnEmailCredit(referrerId, config);

                // SMS send (same target, same day) — CM numbers only,
                // and only for non-subscribed referrals (no CLASSIQUE/CIBLE).
                // A campaign sends SMS only if it was created with SMS (channel
                // sms/both); the field was stored but ignored before.
                const campaignAllowsSms = isDefaultTarget || campaign?.channel !== 'email';
                // An SMS problem must never stop the email above from being recorded:
                // a throw here used to skip target.save(), so the email went out again
                // on every run.
                try {
                    if (config.smsEnabled && config.smsBalance > 0 && campaignAllowsSms) {
                        const phone: string | number | undefined = referralInfo.phoneNumber;
                        if (phone && isCmNumber(phone) && !(await isSmsBlockedBySubscription(referralId))) {
                            const smsTemplate = await RelanceSmsTemplateModel.findOne({
                                type: isDefaultTarget ? 'auto' : 'manual',
                                dayNumber: target.currentDay,
                                active: true
                            });
                            if (smsTemplate && await reserveRelanceCredit(config, 'sms')) {
                                const userLink = (config.smsLinks || []).find((l: any) =>
                                    l.type === (isDefaultTarget ? 'auto' : 'manual') &&
                                    l.dayNumber === target.currentDay
                                );
                                const smsText = smsTemplate.templateText.replace(/\{\{link\}\}/g, userLink?.link || '');
                                const smsSent = await smsService.sendSms({ to: formatCmNumber(phone), body: smsText });
                                if (!smsSent) await refundRelanceCredit(config, 'sms');
                                if (smsSent) {
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
                } catch (smsErr: any) {
                    console.error(`${campaignLabel} day SMS step failed for target ${target._id}: ${smsErr?.message}`);
                }

                // Update campaign stats
                if (campaign) {
                    campaign.messagesSent += 1;
                    campaign.messagesDelivered += 1;
                    await campaign.save();
                }

                // Advance day: J1–J6 → next day in 24h; J7 → completed.
                // (J0 is handled in the SMS-only fast path above and never reaches here.)
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
                await refundRelanceCredit(config, 'email');

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
/**
 * Relance emails go out in the daytime only (Sterling, 2026-10-07): not at
 * night, and not in the evening OTP peak (20:00–23:00 Douala). Within these
 * hours the mail-server budget (send-budget.service) still gives relance only
 * the room OTP leaves. Douala time is UTC+1 all year. Override with
 * RELANCE_SEND_FROM_HOUR / RELANCE_SEND_TO_HOUR (0–24, end exclusive).
 */
const DOUALA_UTC_OFFSET_H = 1;
const SEND_FROM_HOUR = Number(process.env.RELANCE_SEND_FROM_HOUR ?? 7);
const SEND_TO_HOUR = Number(process.env.RELANCE_SEND_TO_HOUR ?? 19);

export function inRelanceSendingHours(now: Date = new Date(), from = SEND_FROM_HOUR, to = SEND_TO_HOUR): boolean {
    const h = (now.getUTCHours() + DOUALA_UTC_OFFSET_H) % 24;
    return from <= to ? h >= from && h < to : h >= from || h < to;
}

export async function runMessageSendingJob(now: Date = new Date()) {
    if (!inRelanceSendingHours(now)) {
        console.log(`[Relance Sender] Outside sending hours (${SEND_FROM_HOUR}:00–${SEND_TO_HOUR}:00 Douala); next run will check again.`);
        return;
    }
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
            // Still close campaigns nobody is left in: this used to run only when
            // some other target happened to be due, so an emptied campaign could
            // stay "active" for months.
            await checkAndCompleteCampaigns();
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

                await resetDailyCountIfNewDay(config);

                console.log(`[Relance Sender] [User:${referrerId.slice(-6)}] Processing ${userTargets.length} targets (email: ${config.emailBalance}, sms: ${config.smsBalance}, sent today ${config.messagesSentToday})...`);
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
    // Wrapped: node-cron passes its own argument, which must not become `now`.
    cron.schedule('*/15 * * * *', () => runMessageSendingJob());

    console.log('[Relance Sender] Job scheduled successfully');

}
