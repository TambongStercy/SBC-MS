import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Target status in the relance loop
 */
export enum TargetStatus {
    ACTIVE = 'active',              // Currently in the loop
    COMPLETED = 'completed',        // Finished (paid or 7 days complete)
    PAUSED = 'paused'              // Manually paused
}

/**
 * Reason for exiting the loop
 */
export enum ExitReason {
    PAID = 'paid',                          // User paid a subscription
    COMPLETED_7_DAYS = 'completed_7days',   // Finished 7-day campaign
    MANUAL = 'manual',                      // Manually removed by admin
    REFERRER_INACTIVE = 'referrer_inactive' // Referrer's subscription expired
}

/**
 * Message delivery status
 */
export enum DeliveryStatus {
    DELIVERED = 'delivered',
    FAILED = 'failed'
}

/**
 * Message delivery record
 */
export interface IMessageDelivery {
    day: number;                    // Which day (1-7)
    sentAt: Date;                   // When the message was sent
    status: DeliveryStatus;         // delivered or failed
    errorMessage?: string;          // Error details if failed
}

/**
 * RelanceTarget Interface
 * Tracks each referral in the 7-day relance loop
 */
export interface IRelanceTarget extends Document {
    _id: Types.ObjectId;
    referralUserId: Types.ObjectId;     // The person who was referred
    referrerUserId: Types.ObjectId;     // SBC member who referred them
    campaignId?: Types.ObjectId;        // Associated campaign (null for default)
    enteredLoopAt: Date;                // When they entered (registration + 1 hour)
    currentDay: number;                 // Current day in the campaign (1-7)
    nextMessageDue: Date;               // When to send next message
    lastMessageSentAt?: Date;           // Last successful message time
    messagesDelivered: IMessageDelivery[];  // History of message deliveries
    exitedLoopAt?: Date;                // When they left the loop
    exitReason?: ExitReason;            // Why they left
    status: TargetStatus;               // active, completed, paused
    language: string;                   // Referral's preferred language (fr/en)
    createdAt: Date;
    updatedAt: Date;
}

/**
 * RelanceTarget Schema
 */
const RelanceTargetSchema = new Schema<IRelanceTarget>(
    {
        referralUserId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true
        },
        referrerUserId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true
        },
        campaignId: {
            type: Schema.Types.ObjectId,
            ref: 'Campaign',
            index: true
        },
        enteredLoopAt: {
            type: Date,
            required: true,
            default: Date.now
        },
        currentDay: {
            type: Number,
            required: true,
            min: 1,
            max: 7,
            default: 1
        },
        nextMessageDue: {
            type: Date,
            required: true,
            index: true             // For finding targets due for messages
        },
        lastMessageSentAt: {
            type: Date
        },
        messagesDelivered: {
            type: [{
                day: { type: Number, required: true },
                sentAt: { type: Date, required: true },
                status: { type: String, enum: Object.values(DeliveryStatus), required: true },
                errorMessage: { type: String }
            }],
            default: []
        },
        exitedLoopAt: {
            type: Date
        },
        exitReason: {
            type: String,
            enum: Object.values(ExitReason)
        },
        status: {
            type: String,
            enum: Object.values(TargetStatus),
            default: TargetStatus.ACTIVE,
            index: true
        },
        language: {
            type: String,
            default: 'fr',
            enum: ['fr', 'en']
        }
    },
    {
        timestamps: true
    }
);

// Compound index for finding active targets due for messages
RelanceTargetSchema.index({ status: 1, nextMessageDue: 1 });

// Index for finding targets by referrer (for dashboard)
RelanceTargetSchema.index({ referrerUserId: 1, status: 1 });

// Index for finding targets by referral (to prevent duplicates)
RelanceTargetSchema.index({ referralUserId: 1, status: 1 });

// Compound index for queries by referrer and current day
RelanceTargetSchema.index({ referrerUserId: 1, currentDay: 1 });

const RelanceTargetModel = mongoose.model<IRelanceTarget>('RelanceTarget', RelanceTargetSchema);

export default RelanceTargetModel;