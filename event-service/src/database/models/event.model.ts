import mongoose, { Document, Schema, Types } from 'mongoose';

export enum EventStatus {
    DRAFT = 'DRAFT',
    /** Submitted by the organizer, waiting for an admin to accept or refuse it. */
    PENDING_REVIEW = 'PENDING_REVIEW',
    /** Refused by an admin — the organizer can edit it and submit it again. */
    REJECTED = 'REJECTED',
    PUBLISHED = 'PUBLISHED',
    SUSPENDED = 'SUSPENDED',
    CANCELLED = 'CANCELLED',
    COMPLETED = 'COMPLETED',
}

/** Online event: no venue, buyers get the organizer's WhatsApp link instead of a place. */
export const WEBINAR_CATEGORY = 'webinaire';
/** What "venue"/"city"/"address" read for a webinar — shown in notices and reminders too. */
export const WEBINAR_VENUE = 'En ligne — lien WhatsApp sur votre billet';

export interface IEvent extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    slug: string;
    title: string;
    description: string;
    posterFileId?: string;
    /** Optional promo video (up to 30 MB — enforced client-side by the organizer form). */
    videoFileId?: string;
    category: string;
    country?: string;
    city: string;
    venue: string;
    address: string;
    startsAt: Date;
    endsAt: Date;
    status: EventStatus;
    /**
     * Webinar only: WhatsApp group / chat / channel link. Paid content —
     * `select: false` so it never rides along on a public query; only the
     * organizer, admins and holders of a valid ticket get it, explicitly.
     */
    accessLink?: string;
    /** Whether users can resell tickets bought for this event (spec §28). */
    resaleEnabled: boolean;
    /** Cap on resale price expressed as percent of original (e.g. 120 = 1.2×). null = use module default. */
    maxResalePricePct: number | null;
    shareUrls?: {
        link?: string;
        whatsapp?: string;
        facebook?: string;
    };
    totals: {
        ticketsSold: number;
        grossRevenue: number;
        commissionRevenue: number;
        checkedIn: number;
    };
    publishedAt?: Date;
    submittedAt?: Date;
    reviewedAt?: Date;
    rejectionReason?: string;
    cancelledAt?: Date;
    cancellationReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const EventSchema = new Schema<IEvent>({
    organizerId: { type: Schema.Types.ObjectId, required: true, ref: 'Organizer', index: true },
    slug: { type: String, required: true, unique: true, maxlength: 140 },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 5000 },
    posterFileId: { type: String },
    videoFileId: { type: String },
    category: { type: String, required: true, maxlength: 60, index: true },
    country: { type: String, maxlength: 60, index: true }, // ISO-2 or French name; used by the public filter (spec §3 uses "ville" but organizers span multiple countries)
    city: { type: String, required: true, maxlength: 80, index: true },
    venue: { type: String, required: true, maxlength: 160 },
    address: { type: String, required: true, maxlength: 300 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: Object.values(EventStatus), default: EventStatus.DRAFT, index: true },
    accessLink: { type: String, maxlength: 500, select: false },
    resaleEnabled: { type: Boolean, default: true },
    maxResalePricePct: { type: Number, default: null },
    shareUrls: {
        link: { type: String },
        whatsapp: { type: String },
        facebook: { type: String },
    },
    totals: {
        ticketsSold: { type: Number, default: 0 },
        grossRevenue: { type: Number, default: 0 },
        commissionRevenue: { type: Number, default: 0 },
        checkedIn: { type: Number, default: 0 },
    },
    publishedAt: { type: Date },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 500 },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, maxlength: 500 },
}, { timestamps: true });

EventSchema.index({ status: 1, startsAt: 1 });
EventSchema.index({ organizerId: 1, createdAt: -1 });
// Text index for public search
EventSchema.index({ title: 'text', description: 'text', city: 'text' });

export default mongoose.model<IEvent>('Event', EventSchema);
