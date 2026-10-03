import mongoose, { Document, Schema, Types } from 'mongoose';

export type AnnouncementFilter = { countries?: string[]; subscription?: 'subscribed' | 'unsubscribed'; sex?: 'male' | 'female' };

/** An admin announcement; kept to cap how often everyone gets one. */
export interface IPushAnnouncement extends Document {
    by: Types.ObjectId;
    title: string;
    body: string;
    url?: string;
    recipients: number;
    /** Who it was for; empty = every member with push on. */
    filter?: AnnouncementFilter;
    toAll: boolean;
    /** Sent at once even at night (an admin's choice). */
    sendNow: boolean;
    createdAt: Date;
}

const PushAnnouncementSchema = new Schema<IPushAnnouncement>(
    {
        by: { type: Schema.Types.ObjectId, required: true },
        title: { type: String, required: true },
        body: { type: String, required: true },
        url: String,
        recipients: { type: Number, default: 0 },
        filter: { type: Schema.Types.Mixed },
        toAll: { type: Boolean, default: true },
        sendNow: { type: Boolean, default: false },
    },
    { timestamps: true },
);

export default mongoose.model<IPushAnnouncement>('PushAnnouncement', PushAnnouncementSchema);
