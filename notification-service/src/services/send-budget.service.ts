import mongoose, { Schema } from 'mongoose';
import config from '../config';

/**
 * Per-minute sending budget on our own mail server (SMART-SENDER-OVERFLOW-SPEC).
 *
 * Every minute has `emailPacing.ratePerMinute` sends. OTP and other
 * transactional mail take a send while any is left. Relance only gets what
 * those are not expected to need: the budget minus the busiest minute of the
 * last five, plus a small margin. So a relance run fills quiet minutes and
 * stands aside at peak, and the mail server never sees the bursts that made
 * Gmail defer us.
 *
 * Counted in Mongo (one document per UTC minute) because several processes
 * send, and the count must be shared and atomic.
 */

interface IEmailSendMinute {
    _id: string; // YYYY-MM-DDTHH:MM (UTC)
    total: number;
    high: number;
    relance: number;
    createdAt: Date;
}

const EmailSendMinuteSchema = new Schema<IEmailSendMinute>(
    {
        _id: { type: String, required: true },
        total: { type: Number, default: 0 },
        high: { type: Number, default: 0 },
        relance: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now, expires: 2 * 24 * 60 * 60 },
    },
    { versionKey: false },
);

export const EmailSendMinuteModel = mongoose.model<IEmailSendMinute>('EmailSendMinute', EmailSendMinuteSchema);

/** Room kept above the recent peak for OTP that arrives later in the minute. */
const HIGH_PRIORITY_MARGIN = 2;
const LOOKBACK_MINUTES = 5;

const minuteKey = (d: Date) => d.toISOString().slice(0, 16);

export const msToNextMinute = (now: Date = new Date()) => 60_000 - (now.getTime() % 60_000);

/** Filter-then-upsert: a full minute fails the filter and the insert hits a duplicate key — that is the "no". */
async function claim(filter: Record<string, unknown>, inc: Record<string, number>): Promise<boolean> {
    try {
        await EmailSendMinuteModel.updateOne(filter, { $inc: inc }, { upsert: true });
        return true;
    } catch (err: any) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

/** OTP and other transactional mail: a send while this minute has any left. */
export function reserveHighPrioritySend(now: Date = new Date()): Promise<boolean> {
    const rate = config.emailPacing.ratePerMinute;
    return claim({ _id: minuteKey(now), total: { $lt: rate } }, { total: 1, high: 1 });
}

/** How many relance sends this minute may take, leaving room for OTP at its recent peak. */
export async function relanceBudget(now: Date = new Date()): Promise<number> {
    const keys = Array.from({ length: LOOKBACK_MINUTES }, (_, i) => minuteKey(new Date(now.getTime() - i * 60_000)));
    const recent = await EmailSendMinuteModel.find({ _id: { $in: keys } }, { high: 1 }).lean();
    const expectedHigh = Math.max(0, ...recent.map(m => m.high ?? 0)) + HIGH_PRIORITY_MARGIN;
    return Math.max(0, config.emailPacing.ratePerMinute - expectedHigh);
}

/** Relance: a send only out of what OTP and transactional mail leave. */
export async function reserveRelanceSend(now: Date = new Date()): Promise<boolean> {
    const budget = await relanceBudget(now);
    if (budget <= 0) return false;
    const rate = config.emailPacing.ratePerMinute;
    return claim({ _id: minuteKey(now), total: { $lt: rate }, relance: { $lt: budget } }, { total: 1, relance: 1 });
}
