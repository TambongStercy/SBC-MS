import InterestQuotaModel from '../models/interest-quota.model';

class InterestQuotaRepository {

    /**
     * Atomically reserve one slot in the weekly quota.
     * Returns true if the slot was acquired, false if the limit was already reached.
     */
    async tryReserve(userId: string, sessionDate: string, max: number): Promise<boolean> {
        // Ensure a quota doc exists for this (user, session) pair.
        await InterestQuotaModel.updateOne(
            { userId, sessionDate },
            { $setOnInsert: { count: 0 } },
            { upsert: true }
        );
        // Conditionally increment only while under the limit — atomic at doc level.
        const result = await InterestQuotaModel.updateOne(
            { userId, sessionDate, count: { $lt: max } },
            { $inc: { count: 1 } }
        );
        return result.modifiedCount > 0;
    }

    /** Release a previously reserved slot (rollback on failed interest insert). */
    async release(userId: string, sessionDate: string): Promise<void> {
        await InterestQuotaModel.updateOne(
            { userId, sessionDate, count: { $gt: 0 } },
            { $inc: { count: -1 } }
        );
    }

    /** Current number of interests used this session. */
    async getCount(userId: string, sessionDate: string): Promise<number> {
        const doc = await InterestQuotaModel.findOne({ userId, sessionDate }).lean();
        return doc?.count ?? 0;
    }
}

export const interestQuotaRepository = new InterestQuotaRepository();
