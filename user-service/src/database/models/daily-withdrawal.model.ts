import { Schema, Document, Types, model } from 'mongoose';

// Interface for daily withdrawal records
export interface IDailyWithdrawal extends Document {
    userId: Types.ObjectId;
    date: Date; // Changed from string to Date type
    count: number;
    totalAmount: number;
    createdAt: Date;
    updatedAt: Date;
}

const DailyWithdrawalSchema = new Schema<IDailyWithdrawal>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        date: {
            type: Date, // Changed from String to Date
            required: true,
            index: true
        },
        count: {
            type: Number,
            default: 0,
            min: 0
        },
        totalAmount: {
            type: Number,
            default: 0,
            min: 0
        }
    },
    {
        timestamps: true,
    }
);

// Define the compound index here instead
DailyWithdrawalSchema.index({ userId: 1, date: 1 }, { unique: true });

const DailyWithdrawalModel = model<IDailyWithdrawal>('DailyWithdrawal', DailyWithdrawalSchema);

export default DailyWithdrawalModel; 