import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * One entry in a member's in-app notification list (the bell). Every push is
 * kept here — chat excepted, conversations have their own unread counts — so a
 * member who missed it on their phone, or has no phone set up, still sees it.
 */
export interface IInboxItem extends Document {
    userId: Types.ObjectId;
    category: string;
    title: string;
    body: string;
    url?: string;
    readAt?: Date;
    createdAt: Date;
}

const InboxItemSchema = new Schema<IInboxItem>(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        category: { type: String, required: true },
        title: { type: String, required: true },
        body: { type: String, required: true },
        url: String,
        readAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);
InboxItemSchema.index({ userId: 1, createdAt: -1 });
InboxItemSchema.index({ userId: 1, readAt: 1 });
// Old notifications go by themselves after 90 days.
InboxItemSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model<IInboxItem>('InboxItem', InboxItemSchema);
