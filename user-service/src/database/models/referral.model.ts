import mongoose, { Schema, Document, Types, model } from 'mongoose';

// Interface defining the Referral document structure
export interface IReferral extends Document {
    referrer: Types.ObjectId; // Ref to 'User'
    referredUser: Types.ObjectId; // Ref to 'User'
    referralLevel: number;
    archived: boolean;
    archivedAt?: Date;
    createdAt: Date;
    // Denormalized fields for fast search (copied from referred user)
    referredUserName?: string;
    referredUserEmail?: string;
    referredUserPhone?: string;
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
        // Denormalized fields for fast search
        referredUserName: {
            type: String,
            index: true,
        },
        referredUserEmail: {
            type: String,
            index: true,
        },
        referredUserPhone: {
            type: String,
            index: true,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt automatically
    }
);

// Compound index for querying referrals by referrer and level, including archived status
ReferralSchema.index({ referrer: 1, referralLevel: 1, archived: 1 });

// Compound indexes for fast search by referrer + searchable fields
ReferralSchema.index({ referrer: 1, referredUserName: 1 });
ReferralSchema.index({ referrer: 1, referredUserEmail: 1 });
ReferralSchema.index({ referrer: 1, referredUserPhone: 1 });


const ReferralModel = model<IReferral>('Referral', ReferralSchema);

export default ReferralModel;