import mongoose, { Document, Schema, Types } from 'mongoose';

export enum EventStatus {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
    SUSPENDED = 'SUSPENDED',
    CANCELLED = 'CANCELLED',
    COMPLETED = 'COMPLETED',
}

export interface IEvent extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    slug: string;
    title: string;
    description: string;
    posterFileId?: string;
    category: string;
    country?: string;
    city: string;
    venue: string;
    address: string;
    startsAt: Date;
    endsAt: Date;
    status: EventStatus;
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
    category: { type: String, required: true, maxlength: 60, index: true },
    country: { type: String, maxlength: 60, index: true }, // ISO-2 or French name; used by the public filter (spec §3 uses "ville" but organizers span multiple countries)
    city: { type: String, required: true, maxlength: 80, index: true },
    venue: { type: String, required: true, maxlength: 160 },
    address: { type: String, required: true, maxlength: 300 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: Object.values(EventStatus), default: EventStatus.DRAFT, index: true },
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
    cancelledAt: { type: Date },
    cancellationReason: { type: String, maxlength: 500 },
}, { timestamps: true });

EventSchema.index({ status: 1, startsAt: 1 });
EventSchema.index({ organizerId: 1, createdAt: -1 });
// Text index for public search
EventSchema.index({ title: 'text', description: 'text', city: 'text' });

export default mongoose.model<IEvent>('Event', EventSchema);
