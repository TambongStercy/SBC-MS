import mongoose, { Schema, Document } from 'mongoose';

export type SmsTemplateType = 'auto' | 'manual';

export interface IRelanceSmsTemplate extends Document {
    type: SmsTemplateType;   // 'auto' = J0–J7 default loop, 'manual' = 7 campaign messages
    dayNumber: number;       // 0–7 for auto (0 = J0 sent at 15 min), 1–7 for manual
    templateText: string;    // Predefined message with {{link}} placeholder
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const RelanceSmsTemplateSchema = new Schema<IRelanceSmsTemplate>(
    {
        type: {
            type: String,
            enum: ['auto', 'manual'] as SmsTemplateType[],
            required: true
        },
        dayNumber: {
            type: Number,
            required: true,
            min: 0,
            max: 7
        },
        templateText: {
            type: String,
            required: true,
            maxlength: 480  // ~3 SMS segments — keep costs predictable
        },
        active: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

// Enforce uniqueness: one active template per type+day
RelanceSmsTemplateSchema.index({ type: 1, dayNumber: 1 }, { unique: true });

const RelanceSmsTemplateModel = mongoose.model<IRelanceSmsTemplate>(
    'RelanceSmsTemplate',
    RelanceSmsTemplateSchema
);

export default RelanceSmsTemplateModel;
