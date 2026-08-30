import mongoose, { Schema, Document, Types } from 'mongoose';

export type BonusTierKey = 'leader' | 'gold' | 'elite';
export type BonusStatus = 'pending' | 'paid' | 'failed';

/**
 * One member's leaderboard bonus for one month.
 *
 * This collection IS the idempotency guarantee: `{ userId, month }` is unique,
 * so a second payout run — a retry, a redeploy, another replica — cannot create
 * a second row, and the credit only ever follows a freshly inserted row. Money
 * moves at most once per member per month by construction, not by convention.
 */
export interface ILeaderboardBonus extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    month: string;            // 'YYYY-MM' in the SBC timezone (Africa/Douala)
    tier: BonusTierKey;
    salesCount: number;       // paid direct filleuls in the month
    amount: number;           // FCFA credited to the ACTIVATION balance
    status: BonusStatus;
    paidAt?: Date;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}

const LeaderboardBonusSchema = new Schema<ILeaderboardBonus>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        month: { type: String, required: true },
        tier: { type: String, required: true, enum: ['leader', 'gold', 'elite'] },
        salesCount: { type: Number, required: true },
        amount: { type: Number, required: true },
        status: { type: String, required: true, enum: ['pending', 'paid', 'failed'], default: 'pending' },
        paidAt: { type: Date },
        error: { type: String },
    },
    { timestamps: true }
);

// The whole safety model in one line.
LeaderboardBonusSchema.index({ userId: 1, month: 1 }, { unique: true });
// Reporting: "what did we pay in July", "what is stuck".
LeaderboardBonusSchema.index({ month: 1, status: 1 });

const LeaderboardBonusModel = mongoose.model<ILeaderboardBonus>('LeaderboardBonus', LeaderboardBonusSchema);

export default LeaderboardBonusModel;
