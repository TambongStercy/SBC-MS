import mongoose, { Document, Schema, Types } from 'mongoose';

/** An announcement held through the night, sent at `sendAt`. */
export interface IPendingPush extends Document {
    userId: Types.ObjectId;
    category: string;
    /** Same user + tag keeps only the latest, so a night of updates becomes one push. */
    tag?: string;
    message: Record<string, unknown>;
    sendAt: Date;
}

const PendingPushSchema = new Schema<IPendingPush>(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        category: { type: String, required: true },
        tag: String,
        message: { type: Schema.Types.Mixed, required: true },
        sendAt: { type: Date, required: true, index: true },
    },
    { timestamps: true },
);
PendingPushSchema.index({ userId: 1, tag: 1 });

export default mongoose.model<IPendingPush>('PendingPush', PendingPushSchema);
