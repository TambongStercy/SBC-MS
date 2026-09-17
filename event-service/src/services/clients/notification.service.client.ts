import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import NotificationLog from '../../database/models/notification-log.model';
import { Types } from 'mongoose';

const log = logger.getLogger('NotificationServiceClient');

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
export const notify = async (args: {
    kind: string;
    userId?: string;
    channel: 'email' | 'sms' | 'push' | 'whatsapp';
    recipient?: string;
    subject?: string;
    body: string;
    data?: Record<string, unknown>;
    // For audit correlation
    orderId?: string;
    ticketId?: string;
    eventId?: string;
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
