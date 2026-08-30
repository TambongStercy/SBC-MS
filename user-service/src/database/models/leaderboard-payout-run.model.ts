import mongoose, { Schema, Document } from 'mongoose';

/**
 * One payout run per month, and the record of what it did.
 *
 * `month` is unique, so with several replicas only the one that wins the insert
 * does the work — the others find the row and stand down. Without it every
 * replica would recompute the same aggregation on the 1st of the month; the
 * unique index on the bonus ledger would still stop double payments, but the
 * duplicated work is free to avoid.
 */
export interface ILeaderboardPayoutRun extends Document {
    month: string;
    startedAt: Date;
    finishedAt?: Date;
    qualifiers: number;
    paid: number;
    skipped: number;      // already paid in an earlier run
    failed: number;
    amountPaid: number;
    triggeredBy: string;  // 'cron' or an admin user id
    createdAt: Date;
    updatedAt: Date;
}

const LeaderboardPayoutRunSchema = new Schema<ILeaderboardPayoutRun>(
    {
        month: { type: String, required: true, unique: true },
        startedAt: { type: Date, required: true },
        finishedAt: { type: Date },
        qualifiers: { type: Number, default: 0 },
        paid: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        amountPaid: { type: Number, default: 0 },
        triggeredBy: { type: String, required: true },
    },
    { timestamps: true }
);

const LeaderboardPayoutRunModel = mongoose.model<ILeaderboardPayoutRun>('LeaderboardPayoutRun', LeaderboardPayoutRunSchema);

export default LeaderboardPayoutRunModel;
