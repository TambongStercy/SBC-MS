import { Types } from 'mongoose';
import { AnimOutbox } from '../models/governance.model';
import { notifyUser } from '../../../services/clients/notification.service.client';
import logger from '../../../utils/logger';

const log = logger.getLogger('AnimationOutbox');

/**
 * Notifications (§29) go through an outbox: a vote spike or a phase change for
 * thousands of candidates must not block the request that caused it, nor send
 * the same notice twice. `dedupeKey` makes enqueueing idempotent; the job
 * leader sends in batches and retries with backoff.
 *
 * Push first. Email only where the content matters (results, prizes, jury
 * invites): the mail server is shared with OTPs and already fragile.
 */
export type OutboxChannel = 'push' | 'email' | 'sms';

export const EMAIL_WORTHY = new Set(['anim-result', 'anim-reward-won', 'anim-jury-invite', 'anim-team-invite', 'anim-challenge-cancelled']);

export const enqueue = async (n: {
    dedupeKey: string;
    kind: string;
    userId: string | Types.ObjectId;
    subject: string;
    body: string;
    data?: Record<string, unknown>;
    eventId?: string | Types.ObjectId;
    channels?: OutboxChannel[];
}) => {
    try {
        await AnimOutbox.updateOne(
            { dedupeKey: n.dedupeKey },
            {
                $setOnInsert: {
                    dedupeKey: n.dedupeKey,
                    kind: n.kind,
                    userId: new Types.ObjectId(String(n.userId)),
                    channels: n.channels ?? (EMAIL_WORTHY.has(n.kind) ? ['push', 'email'] : ['push']),
                    subject: n.subject,
                    body: n.body,
                    data: n.data,
                    eventId: n.eventId ? new Types.ObjectId(String(n.eventId)) : undefined,
                    status: 'PENDING',
                    attempts: 0,
                    nextAt: new Date(),
                },
            },
            { upsert: true },
        );
    } catch (err: any) {
        if (err?.code !== 11000) log.error(`enqueue ${n.dedupeKey} failed: ${err.message}`);
    }
};

const BATCH = 200;
// Backoff 2, 4, 8 … capped at 60 min: 12 attempts span about 8 hours, so a
// notification-service outage or a deploy doesn't lose notices (5 attempts
// used to give up after ~30 min).
const MAX_ATTEMPTS = 12;
const backoffMs = (attempts: number) => Math.min(2 ** attempts, 60) * 60_000;

/** Leader-only: sends due notifications. */
export const flushOutbox = async (): Promise<number> => {
    const due = await AnimOutbox.find({ status: 'PENDING', nextAt: { $lte: new Date() } }).sort({ nextAt: 1 }).limit(BATCH).lean();
    let sent = 0;
    for (const n of due) {
        // Claim, so two leaders in a failover window don't both send.
        const claimed = await AnimOutbox.findOneAndUpdate(
            { _id: n._id, status: 'PENDING', attempts: n.attempts },
            { $inc: { attempts: 1 }, $set: { nextAt: new Date(Date.now() + 60_000) } },
        );
        if (!claimed) continue;
        try {
            // notifyUser never throws; it reports how many channels delivered.
            const delivered = await notifyUser({
                kind: n.kind,
                userId: String(n.userId),
                channels: n.channels as any,
                subject: n.subject,
                body: n.body,
                data: n.data,
                eventId: n.eventId ? String(n.eventId) : undefined,
                // One push per notice on the device: never collapse two refunds or two results.
                pushTag: n.dedupeKey.slice(0, 120),
            });
            if (delivered === 0) throw new Error('no channel delivered');
            await AnimOutbox.updateOne({ _id: n._id }, { $set: { status: 'SENT', sentAt: new Date() } });
            sent++;
        } catch (err) {
            const attempts = n.attempts + 1;
            await AnimOutbox.updateOne({ _id: n._id }, {
                $set: attempts >= MAX_ATTEMPTS
                    ? { status: 'FAILED' }
                    : { nextAt: new Date(Date.now() + backoffMs(attempts)) },
            });
            log.warn(`outbox ${n.dedupeKey} attempt ${attempts} failed: ${(err as Error).message}`);
        }
    }
    return sent;
};
