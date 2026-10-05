import mongoose, { Document, Schema, Types } from 'mongoose';

/** One browser on one device that agreed to receive notifications for a user. */
export interface IPushSubscription extends Document {
    userId: Types.ObjectId;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
    lastSentAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        // The push service URL is unique per browser install; re-subscribing updates it in place.
        endpoint: { type: String, required: true, unique: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
        },
        userAgent: String,
        lastSentAt: Date,
    },
    { timestamps: true },
);

export default mongoose.model<IPushSubscription>('PushSubscription', PushSubscriptionSchema);
