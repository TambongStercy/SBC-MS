import mongoose, { Document, Schema, Types } from 'mongoose';

/** An admin announcement pushed to everyone; kept to cap how often that happens. */
export interface IPushAnnouncement extends Document {
    by: Types.ObjectId;
    title: string;
    body: string;
    url?: string;
    recipients: number;
    createdAt: Date;
}

const PushAnnouncementSchema = new Schema<IPushAnnouncement>(
    {
        by: { type: Schema.Types.ObjectId, required: true },
        title: { type: String, required: true },
        body: { type: String, required: true },
        url: String,
        recipients: { type: Number, default: 0 },
    },
    { timestamps: true },
);

export default mongoose.model<IPushAnnouncement>('PushAnnouncement', PushAnnouncementSchema);
