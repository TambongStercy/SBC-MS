import { Types } from 'mongoose';
import config from '../config';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { displayWhatsappNumber } from '../utils/whatsapp-numbers';
import logger from '../utils/logger';

const log = logger.getLogger('CanalDeVente');

/**
 * Pack Winner members get a canal de vente link
 * (https://canaldevente.sniperbuisnesscenter.com/<referralCode>/<phone>).
 *
 * SBC decides who gets one: only an active Pack Winner member, with the
 * referral code and the WhatsApp number of their SBC account (never anything a
 * browser sends). The canal backend (SBC-security-server) is only called from
 * here, on this machine, with the shared secret; it returns the member's
 * existing link untouched or creates it. The member's app reads the link from
 * SBC (GET /users/me/canal-de-vente), never from the canal backend.
 */

const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
const LINK_RE = /^https:\/\/canaldevente\.sniperbuisnesscenter\.com\/[A-Za-z0-9_-]{3,40}\/\d{8,15}$/;
/** Do not call the canal backend again for a member more often than this. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

export const isCanalConfigured = () => !!config.canalDeVente.secret;

async function isActiveWinner(userId: Types.ObjectId): Promise<boolean> {
    return !!await SubscriptionModel.exists({
        user: userId, subscriptionType: SubscriptionType.WINNER, status: SubscriptionStatus.ACTIVE, endDate: { $gt: new Date() },
    });
}

/** Asks the canal backend for the member's link (existing or new). */
async function requestLink(body: { code: string; phone: string; name: string; notify: boolean }): Promise<string> {
    const res = await fetch(`${config.canalDeVente.url}/internal/links/ensure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Secret': config.canalDeVente.secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`canal backend answered ${res.status}: ${data?.message ?? 'no message'}`);
    const link = String(data?.link ?? '');
    // Only ever store a link on the one public domain, whatever comes back.
    if (!LINK_RE.test(link)) throw new Error('canal backend returned an unexpected link');
    return link;
}

/**
 * Makes sure an active Pack Winner member has their canal de vente link and
 * returns it (null when they are not Winner or it could not be had now).
 * Safe to call any number of times. `notify` = the canal backend sends its
 * WhatsApp message if it creates the link (new Winner members only).
 */
export async function ensureCanalLink(userId: string, opts: { notify?: boolean; force?: boolean } = {}): Promise<string | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const _id = new Types.ObjectId(userId);
    const user = await UserModel.findOne({ _id, deleted: { $ne: true } })
        .select('name referralCode phoneNumber featuredWhatsappNumber canalDeVente blocked').lean() as any;
    if (!user || user.blocked) return null;
    if (user.canalDeVente?.link) return user.canalDeVente.link;
    if (!await isActiveWinner(_id)) return null;
    if (!isCanalConfigured()) {
        log.warn('CANAL_SERVICE_SECRET is not set: canal de vente links are not created');
        return null;
    }
    const lastAttempt = user.canalDeVente?.lastAttemptAt ? new Date(user.canalDeVente.lastAttemptAt).getTime() : 0;
    if (!opts.force && Date.now() - lastAttempt < RETRY_AFTER_MS) return null;

    const code = String(user.referralCode ?? '').trim();
    const phone = displayWhatsappNumber(user).replace(/\D/g, '');
    const name = String(user.name ?? '').trim() || code;
    if (!CODE_RE.test(code) || phone.length < 8 || phone.length > 15) {
        log.error(`Winner ${userId} has no usable referral code or phone for a canal de vente link`);
        await UserModel.updateOne({ _id }, { $set: { 'canalDeVente.lastAttemptAt': new Date(), 'canalDeVente.lastError': 'code ou numéro inutilisable' } });
        return null;
    }

    await UserModel.updateOne({ _id }, { $set: { 'canalDeVente.lastAttemptAt': new Date() } });
    try {
        const link = await requestLink({ code, phone, name, notify: !!opts.notify });
        await UserModel.updateOne({ _id }, {
            $set: { 'canalDeVente.link': link, 'canalDeVente.syncedAt': new Date() },
            $unset: { 'canalDeVente.lastError': 1 },
        });
        log.info(`Canal de vente link ready for Winner ${userId}`);
        return link;
    } catch (err: any) {
        log.error(`Canal de vente link for Winner ${userId} failed: ${err?.message ?? err}`);
        await UserModel.updateOne({ _id }, { $set: { 'canalDeVente.lastError': String(err?.message ?? err).slice(0, 200) } });
        return null;
    }
}

/** Fire-and-forget after a Pack Winner activation: never fails the payment. */
export function ensureCanalLinkInBackground(userId: string): void {
    ensureCanalLink(userId, { notify: true, force: true }).catch(err =>
        log.error(`Canal de vente link for Winner ${userId} failed: ${err?.message ?? err}`));
}

/**
 * Every active Winner member still without a link (the retry job and the
 * one-off script for existing members). Sequential, so the canal backend and
 * its WhatsApp number are never flooded.
 */
export async function ensureMissingCanalLinks(opts: { notify?: boolean; force?: boolean; dryRun?: boolean; limit?: number } = {}) {
    const winners = await SubscriptionModel.distinct('user', {
        subscriptionType: SubscriptionType.WINNER, status: SubscriptionStatus.ACTIVE, endDate: { $gt: new Date() },
    });
    const missing = await UserModel.find({
        _id: { $in: winners }, deleted: { $ne: true }, blocked: { $ne: true }, 'canalDeVente.link': { $exists: false },
    }).select('_id').limit(opts.limit ?? 10000).lean();
    const result = { winners: winners.length, missing: missing.length, linked: 0, failed: 0 };
    if (opts.dryRun) return result;
    for (const u of missing) {
        const link = await ensureCanalLink(String(u._id), { notify: opts.notify, force: opts.force });
        if (link) result.linked++; else result.failed++;
    }
    return result;
}
