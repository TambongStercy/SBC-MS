import { Types } from 'mongoose';
import NotificationModel, { NotificationType } from '../database/models/notification.model';

/**
 * Security plan Phase 11: what became of the sign-in codes sent to these
 * members, so user-service can tell "code not received" (no channel sent it)
 * from "never typed it". Only the delivery facts leave this service: never the
 * code, the message body or the recipient.
 */
export interface OtpDelivery {
    channel: string;
    status: string;
    error: string | null;
    at: Date;
}

const MAX_USERS = 500;
const MAX_PER_USER = 10;

export async function otpDeliveryFor(userIds: string[], since?: Date): Promise<Record<string, OtpDelivery[]>> {
    const ids = [...new Set((userIds || []).filter(id => Types.ObjectId.isValid(id)))].slice(0, MAX_USERS);
    const out: Record<string, OtpDelivery[]> = {};
    if (!ids.length) return out;
    const rows = await NotificationModel.find(
        {
            userId: { $in: ids.map(id => new Types.ObjectId(id)) },
            type: NotificationType.OTP,
            ...(since && !isNaN(since.getTime()) ? { createdAt: { $gte: since } } : {}),
        },
        { userId: 1, channel: 1, status: 1, errorDetails: 1, whatsappStatus: 1, whatsappError: 1, createdAt: 1, sentAt: 1, failedAt: 1, deliveredAt: 1 },
    ).sort({ createdAt: 1 }).lean();
    for (const r of rows as any[]) {
        const key = String(r.userId);
        const list = (out[key] ||= []);
        if (list.length >= MAX_PER_USER) continue;
        // WhatsApp reports its own outcome later (sent → delivered/read, or failed).
        const waFailed = r.channel === 'whatsapp' && (r.whatsappStatus === 'failed' || !!r.whatsappError);
        const status = waFailed ? 'failed' : r.status;
        const error = waFailed
            ? `${r.whatsappError?.code ?? ''} ${r.whatsappError?.title ?? r.whatsappStatus ?? ''}`.trim()
            : (r.errorDetails ? String(r.errorDetails).slice(0, 200) : null);
        list.push({ channel: r.channel, status, error: error || null, at: r.deliveredAt || r.sentAt || r.failedAt || r.createdAt });
    }
    return out;
}
