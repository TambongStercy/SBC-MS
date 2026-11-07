import crypto from 'crypto';
import axios from 'axios';
import { Types } from 'mongoose';
import config from '../config';
import ContactsWebhookEventModel, { ContactsEventType, IContactsWebhookEvent } from '../database/models/contacts-webhook-event.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { getSubscriptionState } from './subscription-state.service';
import logger from '../utils/logger';

const log = logger.getLogger('ContactsWebhook');

/** Retries after a refusal, per the app's note: 1 min, 5 min, 30 min, 2 h; then the event is marked failed. */
const RETRY_DELAYS_MIN = [1, 5, 30, 120];

const enabled = () => !!(config.contactsApp.webhookUrl && config.contactsApp.webhookSecret);

export const signContactsBody = (body: string, secret: string) =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

/**
 * Tells the SBC Contacts app that a member's subscriptions changed. data.user
 * always carries the member's full state, not just the subscription that
 * changed. Never throws: a webhook problem must not undo a paid activation.
 */
export async function emitContactsEvent(userId: string, type: ContactsEventType): Promise<void> {
    if (!enabled()) return;
    try {
        const state = await getSubscriptionState(userId);
        const eventId = `evt_${new Types.ObjectId().toHexString()}`;
        const body = JSON.stringify({
            id: eventId,
            type,
            createdAt: new Date().toISOString(),
            data: { user: { id: userId, ...state } },
        });
        const doc = await ContactsWebhookEventModel.create({
            eventId, type, userId: new Types.ObjectId(userId), body, status: 'pending', attempts: 0, nextAttemptAt: new Date(),
        });
        void deliver(doc);
    } catch (err: any) {
        log.error(`Could not queue ${type} for user ${userId}: ${err?.message ?? err}`);
    }
}

async function deliver(doc: IContactsWebhookEvent): Promise<void> {
    // Claim it so two runs never send the same attempt twice.
    const claimed = await ContactsWebhookEventModel.findOneAndUpdate(
        { _id: doc._id, status: 'pending', nextAttemptAt: { $lte: new Date() } },
        { $set: { nextAttemptAt: new Date(Date.now() + 2 * 60_000) }, $inc: { attempts: 1 } },
        { new: true },
    );
    if (!claimed) return;

    let status = 0;
    let error = '';
    try {
        const res = await axios.post(config.contactsApp.webhookUrl, claimed.body, {
            headers: {
                'Content-Type': 'application/json',
                'X-SBC-Signature': signContactsBody(claimed.body, config.contactsApp.webhookSecret),
            },
            timeout: 10_000,
            validateStatus: () => true,
            transformRequest: [(data) => data], // send the stored bytes as they are
        });
        status = res.status;
        if (status !== 202) error = JSON.stringify(res.data ?? '').slice(0, 300);
    } catch (err: any) {
        error = err?.message ?? String(err);
    }

    if (status === 202) {
        await ContactsWebhookEventModel.updateOne({ _id: claimed._id }, { $set: { status: 'delivered', deliveredAt: new Date(), lastStatus: status }, $unset: { lastError: '' } });
        log.info(`${claimed.type} ${claimed.eventId} delivered for user ${claimed.userId}`);
        return;
    }
    const delay = RETRY_DELAYS_MIN[claimed.attempts - 1];
    const update = delay === undefined
        ? { status: 'failed', lastStatus: status, lastError: error }
        : { nextAttemptAt: new Date(Date.now() + delay * 60_000), lastStatus: status, lastError: error };
    await ContactsWebhookEventModel.updateOne({ _id: claimed._id }, { $set: update });
    log.warn(`${claimed.type} ${claimed.eventId} refused (HTTP ${status || 'none'}: ${error}); ${delay === undefined ? 'giving up' : `retry in ${delay} min`}`);
}

/** Sends every event due for a (re)try. Run every minute. */
export async function deliverDueContactsEvents(limit = 50): Promise<number> {
    if (!enabled()) return 0;
    const due = await ContactsWebhookEventModel.find({ status: 'pending', nextAttemptAt: { $lte: new Date() } })
        .sort({ nextAttemptAt: 1 }).limit(limit);
    for (const doc of due) await deliver(doc);
    return due.length;
}

/**
 * Nothing ever marked a subscription expired: "active" is computed from
 * endDate. The Contacts app needs an event when a paid period ends, so PRO and
 * MISE_EN_AVANT periods that are over are marked expired here and announced.
 */
export async function expireEndedAddons(now: Date = new Date()): Promise<number> {
    const ended = await SubscriptionModel.find({
        subscriptionType: { $in: [SubscriptionType.PRO, SubscriptionType.MISE_EN_AVANT] },
        status: SubscriptionStatus.ACTIVE,
        endDate: { $lte: now },
    }).select('_id user').lean();
    const users = new Set<string>();
    for (const s of ended) {
        const r = await SubscriptionModel.updateOne({ _id: s._id, status: SubscriptionStatus.ACTIVE }, { $set: { status: SubscriptionStatus.EXPIRED } });
        if (r.modifiedCount) users.add(String(s.user));
    }
    for (const u of users) await emitContactsEvent(u, 'subscription.expired');
    return ended.length;
}
