import mongoose, { Schema, Document } from 'mongoose';

export type SmsTemplateType = 'auto' | 'manual';

export interface IRelanceSmsTemplate extends Document {
    type: SmsTemplateType;   // 'auto' = default 7-day loop, 'manual' = campaign sequence
    dayNumber: number;       // 1–7 (both auto and manual)
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
            min: 1,
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
