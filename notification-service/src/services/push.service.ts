import webpush from 'web-push';
import mongoose from 'mongoose';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('PushService');

export type PushMessage = {
    title: string;
    body: string;
    /** Where a tap on the notification opens, relative to the app. */
    url?: string;
    /** Same tag replaces the previous notification instead of stacking. */
    tag?: string;
};

let configured: boolean | null = null;

/** Web push needs a VAPID key pair; without one, push is simply off. */
export function pushEnabled(): boolean {
    if (configured !== null) return configured;
    const { publicKey, privateKey, subject } = config.push;
    configured = !!(publicKey && privateKey);
    if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);
    else log.warn('Web push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set');
    return configured;
}

export async function saveSubscription(
    userId: string,
    sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    userAgent?: string,
): Promise<boolean> {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return false;
    await PushSubscriptionModel.updateOne(
        { endpoint: sub.endpoint },
        { $set: { userId: new mongoose.Types.ObjectId(userId), keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent } },
        { upsert: true },
    );
    return true;
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
    await PushSubscriptionModel.deleteOne({ endpoint, userId: new mongoose.Types.ObjectId(userId) });
}

/**
 * Sends to every device the user enabled. Best-effort: a user without push,
 * or a push service that is down, must never break the caller. Devices the
 * push service says are gone (404/410) are forgotten.
 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
    if (!pushEnabled()) return 0;
    try {
        const subs = await PushSubscriptionModel.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
        const payload = JSON.stringify(message);
        let delivered = 0;
        await Promise.all(subs.map(async s => {
            try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 24 * 60 * 60 });
                delivered++;
                await PushSubscriptionModel.updateOne({ _id: s._id }, { $set: { lastSentAt: new Date() } });
            } catch (err: any) {
                if (err?.statusCode === 404 || err?.statusCode === 410) {
                    await PushSubscriptionModel.deleteOne({ _id: s._id });
                } else {
                    log.warn(`Push to ${userId} failed: ${err?.statusCode ?? ''} ${err?.message ?? err}`);
                }
            }
        }));
        return delivered;
    } catch (err: any) {
        log.error(`Push to ${userId} failed: ${err?.message ?? err}`);
        return 0;
    }
}
