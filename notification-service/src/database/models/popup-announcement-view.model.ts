import mongoose, { Document, Schema, Types } from 'mongoose';

/** One member and one pop-up announcement: when they saw it, closed it, tapped its button. */
export interface IPopupAnnouncementView extends Document {
    announcementId: Types.ObjectId;
    userId: Types.ObjectId;
    shownAt?: Date;
    closedAt?: Date;
    clickedAt?: Date;
}

const PopupAnnouncementViewSchema = new Schema<IPopupAnnouncementView>(
    {
        announcementId: { type: Schema.Types.ObjectId, required: true },
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        shownAt: Date,
        closedAt: Date,
        clickedAt: Date,
    },
    { timestamps: true },
);
PopupAnnouncementViewSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IPopupAnnouncementView>('PopupAnnouncementView', PopupAnnouncementViewSchema);
