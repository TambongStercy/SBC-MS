import { serviceRequest } from './http';
import logger from '../../utils/logger';

const log = logger.getLogger('NotificationClient');

/**
 * notification-service (CONTRACT §2.4). Best-effort: never throws. Email needs
 * `recipient` (the service does not resolve userId → email). No amounts or
 * financial data in any text.
 */
export async function sendEmail(args: { recipient: string; subject: string; body: string; userId?: string; tag?: string }): Promise<boolean> {
    try {
        const r = await serviceRequest('notification', 'POST', '/api/notifications/internal/create', {
            body: {
                userId: args.userId,
                type: 'system',
                channel: 'email',
                recipient: args.recipient,
                data: { subject: args.subject, body: args.body, tag: args.tag },
            },
        });
        if (!r.ok) log.warn('email refused by notification-service', { status: r.status, tag: args.tag });
        return r.ok;
    } catch (err) {
        log.warn('notification-service unreachable (email)', { tag: args.tag, message: (err as Error).message });
        return false;
    }
}

export async function sendPush(args: { userId: string; title: string; body: string; url?: string; tag?: string }): Promise<boolean> {
    try {
        const r = await serviceRequest('notification', 'POST', '/api/notifications/push/internal/send', {
            body: { userId: args.userId, category: 'support', title: args.title, body: args.body, url: args.url, tag: args.tag },
        });
        if (!r.ok) log.warn('push refused by notification-service', { status: r.status, tag: args.tag });
        return r.ok;
    } catch (err) {
        log.warn('notification-service unreachable (push)', { tag: args.tag, message: (err as Error).message });
        return false;
    }
}
