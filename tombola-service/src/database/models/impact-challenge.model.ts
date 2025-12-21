import mongoose, { Schema, Document, Types } from 'mongoose';

// Enum for Challenge Status
export enum ChallengeStatus {
    DRAFT = 'draft',                         // Admin creating campaign
    ACTIVE = 'active',                       // Accepting votes/support
    VOTING_CLOSED = 'voting_closed',         // Campaign ended, calculating winner
    FUNDS_DISTRIBUTED = 'funds_distributed', // Payouts completed
    CANCELLED = 'cancelled'                  // Admin cancelled
}

// Interface for multilingual description
export interface IDescription {
    fr: string;
    en: string;
}

// Interface defining the ImpactChallenge document structure
export interface IImpactChallenge extends Document {
    _id: Types.ObjectId;
    campaignName: string;
    month: number; // 1-12
    year: number;
    status: ChallengeStatus;
    startDate: Date;
    endDate: Date;
    description: IDescription;

    // Linked tombola for lottery
    tombolaMonthId: Types.ObjectId;

    // Fund tracking
    totalCollected: number; // From all votes and supports
    totalVoteCount: number; // Total votes cast

    // Distribution tracking
    fundsDistributed: boolean;
    distributionDate?: Date;
    winnerPayoutAmount?: number; // 50%
    lotteryPoolAmount?: number; // 30%
    commissionAmount?: number; // 20%
    winnerTransactionId?: string;
    lotteryTransactionId?: string;
    commissionTransactionId?: string;

    createdAt: Date;
    updatedAt: Date;
}

// Schema for ImpactChallenge
const ImpactChallengeSchema = new Schema<IImpactChallenge>(
    {
        campaignName: {
            type: String,
            required: true,
            trim: true,
        },
        month: {
            type: Number,
            required: true,
            min: 1,
            max: 12,
        },
        year: {
            type: Number,
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(ChallengeStatus),
            required: true,
            default: ChallengeStatus.DRAFT,
            index: true,
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
        },
        description: {
            fr: {
                type: String,
                required: true,
            },
            en: {
                type: String,
                required: true,
            },
        },
        tombolaMonthId: {
            type: Schema.Types.ObjectId,
            ref: 'TombolaMonth',
            required: true,
            index: true,
        },
        totalCollected: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        totalVoteCount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        fundsDistributed: {
            type: Boolean,
            required: true,
            default: false,
        },
        distributionDate: {
            type: Date,
        },
        winnerPayoutAmount: {
            type: Number,
            min: 0,
        },
        lotteryPoolAmount: {
            type: Number,
            min: 0,
        },
        commissionAmount: {
            type: Number,
            min: 0,
        },
        winnerTransactionId: {
            type: String,
        },
        lotteryTransactionId: {
            type: String,
        },
        commissionTransactionId: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
ImpactChallengeSchema.index({ year: 1, month: 1 }, { unique: true });
ImpactChallengeSchema.index({ status: 1, endDate: 1 });

// Create and export the Mongoose model
const ImpactChallengeModel = mongoose.model<IImpactChallenge>('ImpactChallenge', ImpactChallengeSchema);

export default ImpactChallengeModel;
