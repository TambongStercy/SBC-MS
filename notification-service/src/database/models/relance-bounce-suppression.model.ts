import mongoose, { Schema, Document } from 'mongoose';

export type BounceSource = 'sendgrid_webhook' | 'ses_webhook' | 'backfill';

export interface IRelanceBounceSuppressionEntry extends Document {
    email: string;
    reason?: string;
    bouncedAt: Date;
    source: BounceSource;
    createdAt: Date;
    updatedAt: Date;
}

const RelanceBounceSuppressionSchema = new Schema<IRelanceBounceSuppressionEntry>(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true
        },
        reason: {
            type: String
        },
        bouncedAt: {
            type: Date,
            required: true
        },
        source: {
            type: String,
            enum: ['sendgrid_webhook', 'ses_webhook', 'backfill'] as BounceSource[],
            required: true
        }
    },
    { timestamps: true }
);

const RelanceBounceSuppressionModel = mongoose.model<IRelanceBounceSuppressionEntry>(
    'RelanceBounceSuppression',
    RelanceBounceSuppressionSchema
);

export default RelanceBounceSuppressionModel;
