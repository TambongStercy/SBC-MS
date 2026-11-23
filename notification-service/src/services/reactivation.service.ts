import mongoose, { Schema } from 'mongoose';
import config from '../config';
import { emailService } from './email.service';
import { relanceDailyCapReached, reserveRelanceSend } from './send-budget.service';
import { sendPushToUser, SendOutcome } from './push.service';
import { relanceUnsubscribeUrl } from '../utils/relance-unsubscribe';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import PushPreferenceModel from '../database/models/push-preference.model';
import logger from '../utils/logger';

const log = logger.getLogger('Reactivation');

/**
 * Security plan Phase 7 part 2: the « réactivation » message to dormant accounts.
 *
 * user-service owns the campaign (who, which approved text, once per member per
 * 30 days) and calls this for one member at a time. Here:
 *   - email: never to an address on the suppression list (bounce, complaint OR a
 *     relance unsubscribe: this is bulk mail too), out of relance's share of the
 *     mail server (reserveRelanceSend: the minute's leftovers and relance's daily
 *     total), never Cloudflare, daytime only (relance's hours). No room → the
 *     whole send is `deferred` and nothing is recorded, so it can be retried;
 *   - push: category « announcements » (members who turned them off get none;
 *     held at night like every announcement);
 *   - one delivery per member per campaign (reactivation_deliveries, unique), so a
 *     retried call after a lost answer never sends twice.
 * The text comes from user-service (approved there), as plain text; it is escaped
 * here and always followed by a fixed safety line that the editable text cannot remove.
 */

export type EmailOutcome = 'sent' | 'failed' | 'suppressed' | 'invalid' | 'none';
export interface ReactivationResult {
    status: 'done' | 'deferred' | 'duplicate';
    email?: EmailOutcome;
    push?: SendOutcome | 'none';
    retryAt?: string;
}

interface IDelivery {
    campaignId: string;
    userId: string;
    status: 'sending' | 'done';
    email?: string;
    push?: string;
    at: Date;
}
const DeliverySchema = new Schema<IDelivery>({
    campaignId: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, required: true },
    email: { type: String },
    push: { type: String },
    at: { type: Date, default: () => new Date() },
}, { collection: 'reactivation_deliveries', versionKey: false });
DeliverySchema.index({ campaignId: 1, userId: 1 }, { unique: true });
DeliverySchema.index({ at: 1 }, { expireAfterSeconds: 400 * 86400 });
export const ReactivationDeliveryModel = mongoose.models.ReactivationDelivery
    || mongoose.model<IDelivery>('ReactivationDelivery', DeliverySchema);

export const SAFETY_LINE = 'SBC ne vous demandera jamais votre mot de passe ni vos codes de connexion, ni par e-mail, ni par téléphone, ni sur WhatsApp. Ne les donnez à personne.';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const firstName = (name: unknown) => (typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0].slice(0, 40) : '');
export const fillName = (text: string, name: unknown) => text.replace(/\{\{\s*nom\s*\}\}/gi, firstName(name) || 'cher membre');

/** The email: the approved paragraphs, one button to the app's home, the safety line, the unsubscribe link. */
export function reactivationHtml(subject: string, body: string, name: unknown, email: string): string {
    const home = (config.app.frontendUrl || 'https://sniperbuisnesscenter.com').replace(/\/+$/, '') + '/';
    const paragraphs = fillName(body, name).split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
        .map(p => `<p style="margin:0 0 14px 0;line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
    const content = `${paragraphs}
        <p style="text-align:center;margin:24px 0;"><a href="${home}" style="background:#115CF6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Ouvrir SBC</a></p>
        <p style="margin:18px 0 0 0;padding:12px;background:#FEF3C7;border-radius:8px;font-size:13px;line-height:1.5;color:#92400E;">${escapeHtml(SAFETY_LINE)}</p>
        <p style="margin:18px 0 0 0;font-size:12px;color:#6B7280;">Vous ne voulez plus recevoir ces messages ? <a href="${relanceUnsubscribeUrl(email)}" style="color:#6B7280;">Se désabonner</a></p>`;
    return emailService.createBaseTemplate(escapeHtml(fillName(subject, name)), content, 'Sniper Business Center');
}

/** Relance's daytime window (RELANCE_SEND_FROM_HOUR / _TO_HOUR, Douala = UTC+1), read the same way. */
export function inRelanceSendingHours(now: Date): boolean {
    const from = Number(process.env.RELANCE_SEND_FROM_HOUR ?? 7);
    const to = Number(process.env.RELANCE_SEND_TO_HOUR ?? 19);
    const h = (now.getUTCHours() + 1) % 24;
    return from <= to ? h >= from && h < to : h >= from || h < to;
}

const nextMinute = (now: Date) => new Date(Math.ceil((now.getTime() + 1) / 60_000) * 60_000);

/** The next start of the daytime window (relance's hours), checked hour by hour. */
function nextSendingWindow(now: Date): Date {
    const t = new Date(now);
    t.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < 48; i++) {
        t.setUTCHours(t.getUTCHours() + 1);
        if (inRelanceSendingHours(t)) return t;
    }
    return new Date(now.getTime() + 3_600_000);
}

export interface ReactivationInput {
    campaignId: string;
    userId: string;
    email?: string | null;
    name?: string | null;
    subject: string;
    body: string;
    pushTitle: string;
    pushBody: string;
}

export async function sendReactivation(input: ReactivationInput, now: Date = new Date()): Promise<ReactivationResult> {
    if (!inRelanceSendingHours(now)) return { status: 'deferred', retryAt: nextSendingWindow(now).toISOString() };

    // Claim this member for this campaign; a second call after a lost answer finds the first.
    try {
        await ReactivationDeliveryModel.create({ campaignId: input.campaignId, userId: input.userId, status: 'sending', at: now });
    } catch (err: any) {
        if (err?.code !== 11000) throw err;
        const prev: any = await ReactivationDeliveryModel.findOne({ campaignId: input.campaignId, userId: input.userId }).lean();
        if (prev?.status === 'done') return { status: 'duplicate', email: prev.email, push: prev.push };
        // 'sending' left by a crash mid-send: nothing knows whether it went, so it is not sent again.
        return { status: 'duplicate', email: 'failed', push: 'none' };
    }
    const release = () => ReactivationDeliveryModel.deleteOne({ campaignId: input.campaignId, userId: input.userId, status: 'sending' });

    try {
        let email: EmailOutcome = 'none';
        const address = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (address) {
            if (await RelanceBounceSuppressionModel.exists({ email: address })) email = 'suppressed';
            else {
                const subject = fillName(input.subject, input.name);
                const html = reactivationHtml(input.subject, input.body, input.name, address);
                if (!emailService.passesPreflight({ to: address, subject, html })) email = 'invalid';
                else if (!(await reserveRelanceSend(now))) {
                    await release();
                    const retryAt = (await relanceDailyCapReached(now)) ? nextSendingWindow(new Date(now.getTime() + 12 * 3_600_000)) : nextMinute(now);
                    return { status: 'deferred', retryAt: retryAt.toISOString() };
                } else {
                    const r = await emailService.sendEmailWithTracking({ to: address, subject, html, from: config.email.from });
                    email = r.success ? 'sent' : 'failed';
                }
            }
        }
        const push = await sendPushToUser(input.userId, {
            title: fillName(input.pushTitle, input.name).slice(0, 120),
            body: fillName(input.pushBody, input.name).slice(0, 400),
            url: '/',
            tag: `reactivation-${input.campaignId}`,
        }, { category: 'announcements', now });
        await ReactivationDeliveryModel.updateOne({ campaignId: input.campaignId, userId: input.userId }, { $set: { status: 'done', email, push } });
        log.info(`Reactivation ${input.campaignId} → ${input.userId}: email ${email}, push ${push}`);
        return { status: 'done', email, push };
    } catch (err) {
        await release().catch(() => undefined);
        throw err;
    }
}

/**
 * For the admin preview: which addresses will get no email (suppression list) and
 * which members can get a push (a device, « Annonces SBC » not turned off).
 */
export async function reactivationReach(emails: string[], userIds: string[]): Promise<{ suppressedEmails: string[]; pushReachable: string[] }> {
    const cleanEmails = [...new Set(emails.filter(e => typeof e === 'string' && e.includes('@')).map(e => e.trim().toLowerCase()))].slice(0, 5000);
    const ids = [...new Set(userIds.filter(id => mongoose.isValidObjectId(id)))].slice(0, 5000);
    const [suppressed, withDevice, off] = await Promise.all([
        cleanEmails.length ? RelanceBounceSuppressionModel.find({ email: { $in: cleanEmails } }, { email: 1 }).lean() : [],
        ids.length ? PushSubscriptionModel.distinct('userId', { userId: { $in: ids.map(i => new mongoose.Types.ObjectId(i)) } }) : [],
        ids.length ? PushPreferenceModel.distinct('userId', { userId: { $in: ids.map(i => new mongoose.Types.ObjectId(i)) }, disabled: 'announcements' }) : [],
    ]);
    const offSet = new Set((off as any[]).map(String));
    return {
        suppressedEmails: (suppressed as any[]).map(s => String(s.email)),
        pushReachable: (withDevice as any[]).map(String).filter(id => !offSet.has(id)),
    };
}
