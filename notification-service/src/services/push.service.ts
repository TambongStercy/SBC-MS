import webpush from 'web-push';
import mongoose from 'mongoose';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import PushPreferenceModel from '../database/models/push-preference.model';
import PendingPushModel from '../database/models/pending-push.model';
import InboxItemModel from '../database/models/inbox-item.model';
import { defaultCta, endOfQuietHours, inQuietHours, isUrgent, PushCategory } from './push-categories';
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
    /** Picture shown with the notification (a sender's or group's photo): an app path such as /api/settings/files/<id>?w=128, or an https URL. */
    icon?: string;
    /** With a tag: buzz again when it replaces an earlier notification (chat). */
    renotify?: boolean;
    /**
     * The button on the notification (it opens url). Chrome adds its own
     * "Unsubscribe" on sites that are not installed; this is ours, beside it.
     * Defaults to the kind's (push-categories).
     */
    cta?: string;
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

/** Sends to every device of the user, now. Devices the push service says are gone (404/410) are forgotten. */
async function deliver(userId: string, message: PushMessage, urgent: boolean): Promise<number> {
    const subs = await PushSubscriptionModel.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    const payload = JSON.stringify(message);
    let delivered = 0;
    await Promise.all(subs.map(async s => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
                TTL: 24 * 60 * 60,
                // Android holds back normal-urgency pushes while the phone is idle.
                urgency: urgent ? 'high' : 'normal',
            });
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
}

/** Saves a notification to the member's in-app list. Never throws. */
async function recordInbox(userId: string, message: PushMessage, category: PushCategory): Promise<void> {
    try {
        await InboxItemModel.create({
            userId: new mongoose.Types.ObjectId(userId),
            category,
            title: message.title,
            body: message.body,
            ...(message.url ? { url: message.url } : {}),
        });
    } catch (err: any) {
        log.warn(`Inbox record for ${userId} failed: ${err?.message ?? err}`);
    }
}

export type SendOutcome = 'sent' | 'deferred' | 'off' | 'no_device' | 'disabled';

/**
 * Sends a push to every device a user enabled — unless they turned this kind
 * off, or it is night and it can wait (then it goes at 07:00 Douala time).
 * Best-effort: never throws, so a push can never break the caller.
 */
export async function sendPushToUser(
    userId: string,
    message: PushMessage,
    opts: { category: PushCategory; now?: Date },
): Promise<SendOutcome> {
    // The bell keeps every notification, whether or not it reaches a phone —
    // except chat: conversations carry their own unread counts.
    if (opts.category !== 'chat') await recordInbox(userId, message, opts.category);
    message = { ...message, cta: message.cta ?? defaultCta(opts.category) };
    if (!pushEnabled()) return 'off';
    try {
        const uid = new mongoose.Types.ObjectId(userId);
        if (!(await PushSubscriptionModel.exists({ userId: uid }))) return 'no_device';
        if (await PushPreferenceModel.exists({ userId: uid, disabled: opts.category })) return 'disabled';

        const now = opts.now ?? new Date();
        const urgent = isUrgent(opts.category);
        if (!urgent && inQuietHours(now)) {
            const pending = { userId: uid, category: opts.category, tag: message.tag, message, sendAt: endOfQuietHours(now) };
            if (message.tag) await PendingPushModel.updateOne({ userId: uid, tag: message.tag }, { $set: pending }, { upsert: true });
            else await PendingPushModel.create(pending);
            return 'deferred';
        }
        await deliver(userId, message, urgent);
        return 'sent';
    } catch (err: any) {
        log.error(`Push to ${userId} failed: ${err?.message ?? err}`);
        return 'off';
    }
}

/** Sends the pushes held through the night once their time has come. */
export async function flushDuePushes(now: Date = new Date()): Promise<number> {
    if (!pushEnabled()) return 0;
    const due = await PendingPushModel.find({ sendAt: { $lte: now } }).limit(5000).lean();
    for (const p of due) {
        // A kind turned off during the night stays off.
        if (!(await PushPreferenceModel.exists({ userId: p.userId, disabled: p.category }))) {
            await deliver(String(p.userId), p.message as PushMessage, false).catch(() => 0);
        }
        await PendingPushModel.deleteOne({ _id: p._id });
    }
    return due.length;
}

/** Everyone with at least one device. For announcements. */
export async function usersWithDevices(): Promise<string[]> {
    return (await PushSubscriptionModel.distinct('userId')).map(String);
}
