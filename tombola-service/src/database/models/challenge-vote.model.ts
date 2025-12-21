import mongoose, { Schema, Document, Types } from 'mongoose';

// Enum for Payment Status
export enum VotePaymentStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

// Enum for Vote Type
export enum VoteType {
    VOTE = 'vote',       // Members only, generates lottery tickets
    SUPPORT = 'support'  // Anyone, no lottery tickets
}

// Interface defining the ChallengeVote document structure
export interface IChallengeVote extends Document {
    _id: Types.ObjectId;
    challengeId: Types.ObjectId;
    entrepreneurId: Types.ObjectId;
    userId?: Types.ObjectId; // Null for non-member support

    // Payment tracking
    amountPaid: number;
    voteQuantity: number; // amountPaid / 200
    paymentIntentId?: string;
    paymentStatus: VotePaymentStatus;

    // Vote type determines ticket generation
    voteType: VoteType;

    // For support (non-members)
    supporterName?: string;
    supporterEmail?: string;
    supporterPhone?: string;
    supportMessage?: string;
    isAnonymous: boolean;

    // Lottery tickets (only for voteType = 'vote')
    tombolaTicketIds: Types.ObjectId[]; // Empty if voteType = 'support'
    ticketsGenerated: boolean; // false if voteType = 'support'
    ticketGenerationError?: string;

    // Metadata
    ipAddress?: string;
    userAgent?: string;

    createdAt: Date;
    updatedAt: Date;
}

// Schema for ChallengeVote
const ChallengeVoteSchema = new Schema<IChallengeVote>(
    {
        challengeId: {
            type: Schema.Types.ObjectId,
            ref: 'ImpactChallenge',
            required: true,
            index: true,
        },
        entrepreneurId: {
            type: Schema.Types.ObjectId,
            ref: 'Entrepreneur',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            index: true,
        },
        amountPaid: {
            type: Number,
            required: true,
            min: 200, // Minimum one vote
        },
        voteQuantity: {
            type: Number,
            required: true,
            min: 1,
        },
        paymentIntentId: {
            type: String,
            index: true,
        },
        paymentStatus: {
            type: String,
            enum: Object.values(VotePaymentStatus),
            required: true,
            default: VotePaymentStatus.PENDING,
            index: true,
        },
        voteType: {
            type: String,
            enum: Object.values(VoteType),
            required: true,
            index: true,
        },
        supporterName: {
            type: String,
            trim: true,
        },
        supporterEmail: {
            type: String,
            trim: true,
            lowercase: true,
        },
        supporterPhone: {
            type: String,
            trim: true,
        },
        supportMessage: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        isAnonymous: {
            type: Boolean,
            required: true,
            default: false,
        },
        tombolaTicketIds: [{
            type: Schema.Types.ObjectId,
            ref: 'TombolaTicket',
        }],
        ticketsGenerated: {
            type: Boolean,
            required: true,
            default: false,
        },
        ticketGenerationError: {
            type: String,
        },
        ipAddress: {
            type: String,
        },
        userAgent: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
ChallengeVoteSchema.index({ challengeId: 1, entrepreneurId: 1 });
ChallengeVoteSchema.index({ userId: 1, challengeId: 1 });
ChallengeVoteSchema.index({ paymentStatus: 1, voteType: 1 });

// Create and export the Mongoose model
const ChallengeVoteModel = mongoose.model<IChallengeVote>('ChallengeVote', ChallengeVoteSchema);

export default ChallengeVoteModel;
