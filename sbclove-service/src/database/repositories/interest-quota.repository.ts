import { Types } from 'mongoose';
import InterestQuotaModel from '../models/interest-quota.model';

export class InterestQuotaRepository {

    /**
     * Atomically reserves one interest slot for the session if the user is under
     * the limit. Returns true if a slot was reserved, false if the limit is
     * already reached. Race-free: the conditional `$inc` only matches while
     * `count < max`, so concurrent callers can never push the count past `max`.
     */
    async tryReserve(userId: Types.ObjectId | string, sessionDate: string, max: number): Promise<boolean> {
        // Ensure the counter document exists (no-op if already there).
        await InterestQuotaModel.updateOne(
            { userId, sessionDate },
            { $setOnInsert: { count: 0 } },
            { upsert: true }
        );
        // Reserve a slot only while under the limit.
        const reserved = await InterestQuotaModel.findOneAndUpdate(
            { userId, sessionDate, count: { $lt: max } },
            { $inc: { count: 1 } },
            { new: true }
        ).lean().exec();
        return !!reserved;
    }

    /** Releases a previously reserved slot (e.g. when the interest insert fails). */
    async release(userId: Types.ObjectId | string, sessionDate: string): Promise<void> {
        await InterestQuotaModel.updateOne(
            { userId, sessionDate, count: { $gt: 0 } },
            { $inc: { count: -1 } }
        );
    }

    async getCount(userId: Types.ObjectId | string, sessionDate: string): Promise<number> {
        const doc = await InterestQuotaModel.findOne({ userId, sessionDate }).lean().exec();
        return doc?.count ?? 0;
    }
}

export const interestQuotaRepository = new InterestQuotaRepository();
