import mongoose, { Document, Schema, Types } from 'mongoose';
import type { AnnouncementTargeting } from '../../services/announcement-targeting';

export type PopupStatus = 'active' | 'paused' | 'ended';

/**
 * An admin announcement shown as a pop-up when a member opens the app, to the
 * members its `filter` picks (none = everyone), between `startsAt` and `endsAt`.
 * A member sees it until they close it or tap its button, then never again.
 */
export interface IPopupAnnouncement extends Document {
    by: Types.ObjectId;
    title: string;
    message: string;
    imageUrl?: string;
    buttonLabel?: string;
    /** An app path (/abonnement) or an https link. */
    buttonUrl?: string;
    filter?: AnnouncementTargeting;
    /** Members the filter reached when it was saved (all members, push or not). */
    audience: number;
    status: PopupStatus;
    startsAt: Date;
    endsAt?: Date;
    stats: { shown: number; closed: number; clicked: number };
    createdAt: Date;
    updatedAt: Date;
}

const PopupAnnouncementSchema = new Schema<IPopupAnnouncement>(
    {
        by: { type: Schema.Types.ObjectId, required: true },
        title: { type: String, required: true, maxlength: 120 },
        message: { type: String, required: true, maxlength: 1500 },
        imageUrl: String,
        buttonLabel: { type: String, maxlength: 40 },
        buttonUrl: { type: String, maxlength: 500 },
        filter: { type: Schema.Types.Mixed },
        audience: { type: Number, default: 0 },
        status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active', index: true },
        startsAt: { type: Date, required: true },
        endsAt: Date,
        stats: {
            shown: { type: Number, default: 0 },
            closed: { type: Number, default: 0 },
            clicked: { type: Number, default: 0 },
        },
    },
    { timestamps: true },
);
PopupAnnouncementSchema.index({ status: 1, startsAt: -1 });

export default mongoose.model<IPopupAnnouncement>('PopupAnnouncement', PopupAnnouncementSchema);
