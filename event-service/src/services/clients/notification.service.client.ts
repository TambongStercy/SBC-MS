import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import NotificationLog from '../../database/models/notification-log.model';
import { Types } from 'mongoose';
import { getEventUserDetails } from './user.service.client';

const log = logger.getLogger('NotificationServiceClient');

export type Channel = 'email' | 'sms' | 'push' | 'whatsapp';

const client = axios.create({
    baseURL: config.services.notificationService,
    timeout: 8000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'event-service',
    },
});

/**
 * Best-effort notification send. NEVER throws — a notification failure must not
 * roll back a payment settlement. Logs to NotificationLog for audit.
 *
 * `recipient` is REQUIRED for email/sms (CLAUDE.md gotcha: notification-service
 * does not resolve userId → email; a missing recipient silently 400s and every
 * caller returns 2xx-shaped success without delivering).
 */
/**
 * What a push of this kind opens, and which of the user's push settings it
 * falls under. Money coming back (refund, resale) is "money": it goes out at
 * any hour; the rest waits for the morning if it lands at night.
 */
// cta: the notification's button; without one notification-service uses the
// category's ("Voir mes billets" for events), which is wrong for animation notices.
const PUSH_ROUTES: Record<string, { url: string; category: 'events' | 'money'; cta?: string }> = {
    'event-ticket-purchased': { url: '/events/mes-billets', category: 'events' },
    'event-cancelled': { url: '/events/mes-billets', category: 'events' },
    'event-reminder': { url: '/events/mes-billets', category: 'events' },
    'refund-processed': { url: '/wallet', category: 'money' },
    'resale-sold': { url: '/wallet', category: 'money' },
    'resale-listing-suspended': { url: '/events/mes-billets', category: 'events' },
    'resale-listing-removed': { url: '/events/mes-billets', category: 'events' },
    'dispute-resolved': { url: '/events/mes-disputes', category: 'events' },
    'event-approved': { url: '/events/organizer', category: 'events' },
    'event-rejected': { url: '/events/organizer', category: 'events' },
    // Animation & Engagement
    'anim-candidate-registered': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-candidate-approved': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-candidate-rejected': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-candidate-disqualified': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-challenge-cancelled': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-voting-open': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-voting-closed': { url: '/events/mes-defis', category: 'events', cta: 'Mes défis' },
    'anim-result': { url: '/events/mes-defis', category: 'events', cta: 'Voir mon résultat' },
    'anim-reward-won': { url: '/events/mes-defis?tab=rewards', category: 'events', cta: 'Voir mon gain' },
    'anim-vote-refunded': { url: '/wallet', category: 'money', cta: 'Voir mon solde' },
    'anim-jury-invite': { url: '/events/jury', category: 'events', cta: 'Noter les candidats' },
    'anim-team-invite': { url: '/events/equipe', category: 'events', cta: 'Ouvrir l’animation' },
    'anim-change-reviewed': { url: '/events/organizer/{eventId}/animation', category: 'events', cta: 'Voir le défi' },
};

/**
 * Push routing for a kind. `{eventId}` in a route is filled from the event.
 * `tag` replaces the default one: a device shows only the latest push per
 * tag, so notices that must not collapse (two refunds, two results) need
 * their own.
 */
export const pushRelatedData = (kind: string, ref?: string, opts: { eventId?: string; tag?: string } = {}) => {
    const route = PUSH_ROUTES[kind] ?? { url: '/events', category: 'events' as const };
    const url = route.url.includes('{eventId}')
        ? (opts.eventId ? route.url.replace('{eventId}', opts.eventId) : '/events/organizer')
        : route.url;
    return { pushCategory: route.category, url, pushTag: opts.tag ?? (ref ? `${kind}-${ref}` : kind), ...(route.cta ? { pushCta: route.cta } : {}) };
};

export const notify = async (args: {
    kind: string;
    userId?: string;
    channel: Channel;
    recipient?: string;
    subject?: string;
    body: string;
    data?: Record<string, unknown>;
    // For audit correlation
    orderId?: string;
    ticketId?: string;
    eventId?: string;
    /** Own push tag (see pushRelatedData). */
    pushTag?: string;
}): Promise<boolean> => {
    if ((args.channel === 'email' || args.channel === 'sms') && !args.recipient) {
        log.warn(`${args.kind}: no recipient for ${args.channel}; skipping`);
        await logAttempt(args, false, 'missing recipient');
        return false;
    }

    try {
        const { data } = await client.post('/notifications/internal/create', {
            userId: args.userId,
            type: 'system',
            channel: args.channel,
            recipient: args.recipient,
            data: {
                subject: args.subject,
                body: args.body,
                ...args.data,
                ...(args.channel === 'push'
                    ? { relatedData: pushRelatedData(args.kind, args.orderId ?? args.ticketId ?? args.eventId, { eventId: args.eventId, tag: args.pushTag }) }
                    : {}),
            },
        });
        const ok = Boolean(data?.success);
        await logAttempt(args, ok, ok ? undefined : (data?.message || 'notification-service refused'));
        return ok;
    } catch (err) {
        log.warn(`${args.kind}: notification-service call failed: ${(err as Error).message}`);
        await logAttempt(args, false, (err as Error).message);
        return false;
    }
};

const logAttempt = async (
    args: { kind: string; userId?: string; channel: string; recipient?: string; orderId?: string; ticketId?: string; eventId?: string },
    delivered: boolean,
    reason?: string,
) => {
    try {
        await NotificationLog.create({
            kind: args.kind,
            userId: args.userId ? new Types.ObjectId(args.userId) : undefined,
            orderId: args.orderId ? new Types.ObjectId(args.orderId) : undefined,
            ticketId: args.ticketId ? new Types.ObjectId(args.ticketId) : undefined,
            eventId: args.eventId ? new Types.ObjectId(args.eventId) : undefined,
            channel: args.channel,
            recipient: args.recipient,
            delivered,
            reason,
            at: new Date(),
        });
    } catch (err) {
        log.warn(`NotificationLog write failed: ${(err as Error).message}`);
    }
};

/**
 * Pure fan-out decision: which of the requested channels actually get an attempt,
 * and with which recipient string. No I/O — the runnable check in
 * `src/scripts/check-notify-channels.ts` asserts this table.
 *
 * Rules (from notification-service's own contract):
 *  - a deployment can switch channels off entirely (EVENT_NOTIFY_CHANNELS)
 *  - email needs an address, sms/whatsapp need a phone — without one, skip
 *  - `recipient` is `required: true` on notification-service's schema for EVERY
 *    channel (the controller waives it for push but the model doesn't, so a push
 *    without one 500s). Push therefore carries any known coordinate as a label;
 *    what identifies the target is `userId`.
 */
export const planChannels = (args: {
    channels: Channel[];
    email?: string;
    phone?: string;
    userId?: string;
    /** Defaults to the deployment's EVENT_NOTIFY_CHANNELS. */
    enabled?: string[];
}): { channel: Channel; recipient: string }[] => {
    const enabled = args.enabled ?? config.notifyChannels;
    const plan: { channel: Channel; recipient: string }[] = [];
    for (const channel of args.channels) {
        if (!enabled.includes(channel) || plan.some((p) => p.channel === channel)) continue;
        const recipient =
            channel === 'email' ? args.email
                : channel === 'sms' || channel === 'whatsapp' ? args.phone
                    : args.userId && (args.email || args.phone || args.userId);
        if (!recipient) continue;
        plan.push({ channel, recipient });
    }
    return plan;
};

/**
 * Multi-channel best-effort send (spec §23: push + SMS + email). Every channel is
 * attempted independently — a dead SMS provider must not cost the buyer their
 * email — and NOTHING here throws into a payment/settlement path.
 *
 * Coordinates already in hand (order.holder) win; user-service is only consulted
 * when a requested channel has no coordinate. One NotificationLog row per
 * attempted channel, as before.
 */
export const notifyUser = async (args: {
    kind: string;
    userId?: string;
    email?: string;
    phone?: string;
    channels: Channel[];
    subject?: string;
    body: string;
    data?: Record<string, unknown>;
    orderId?: string;
    ticketId?: string;
    eventId?: string;
    pushTag?: string;
}): Promise<number> => {
    let { email, phone } = args;
    const wanted = args.channels.filter((c) => config.notifyChannels.includes(c));
    const needsLookup =
        (wanted.includes('email') && !email) ||
        ((wanted.includes('sms') || wanted.includes('whatsapp')) && !phone);
    if (needsLookup && args.userId) {
        try {
            const [profile] = await getEventUserDetails([args.userId]);
            email = email || profile?.email;
            phone = phone || profile?.phoneNumber;
        } catch (err) {
            log.warn(`${args.kind}: profile lookup failed for ${args.userId}: ${(err as Error).message}`);
        }
    }

    const plan = planChannels({ channels: args.channels, email, phone, userId: args.userId });
    if (plan.length === 0) {
        log.warn(`${args.kind}: no usable channel for user ${args.userId} (wanted ${args.channels.join(',')})`);
        return 0;
    }

    const results = await Promise.allSettled(
        plan.map(({ channel, recipient }) => notify({ ...args, channel, recipient })),
    );
    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
};
