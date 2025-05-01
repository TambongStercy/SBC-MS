import mongoose, { Schema, Document, Types, model } from 'mongoose';

// Interface defining the Referral document structure
export interface IReferral extends Document {
    referrer: Types.ObjectId; // Ref to 'User'
    referredUser: Types.ObjectId; // Ref to 'User'
    referralLevel: number;
    archived: boolean;
    archivedAt?: Date;
    createdAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
    {
        referrer: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        referredUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        referralLevel: {
            type: Number,
            required: true,
            min: 1,
            max: 3, // Assuming max 3 levels as per original doc
            index: true,
        },
        archived: {
            type: Boolean,
            default: false,
            index: true,
        },
        archivedAt: {
            type: Date,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false }, // Only add createdAt automatically
    }
);

const ReferralModel = model<IReferral>('Referral', ReferralSchema);

export default ReferralModel; 