import mongoose, { Document, Schema, Types } from 'mongoose';

export enum ResaleListingStatus {
    DRAFT = 'DRAFT',
    ACTIVE = 'ACTIVE',
    SOLD = 'SOLD',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED',
    SUSPENDED = 'SUSPENDED',
}

export interface IResaleListing extends Document {
    _id: Types.ObjectId;
    ticketId: Types.ObjectId;
    sellerUserId: Types.ObjectId;
    eventId: Types.ObjectId;
    originalPrice: number;
    askingPrice: number;
    status: ResaleListingStatus;
    listedAt: Date;
    soldAt?: Date;
    cancelledAt?: Date;
    suspendedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ResaleListingSchema = new Schema<IResaleListing>({
    ticketId: { type: Schema.Types.ObjectId, required: true, ref: 'Ticket', index: true },
    sellerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    originalPrice: { type: Number, required: true, min: 0 },
    askingPrice: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(ResaleListingStatus), default: ResaleListingStatus.DRAFT, index: true },
    listedAt: { type: Date, required: true, default: () => new Date() },
    soldAt: { type: Date },
    cancelledAt: { type: Date },
    suspendedAt: { type: Date },
}, { timestamps: true });

// Enforces spec §27: a given ticket may only appear in one ACTIVE listing at a time.
// Partial-unique so historical CANCELLED/SOLD rows don't collide.
ResaleListingSchema.index(
    { ticketId: 1 },
    { unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);
ResaleListingSchema.index({ eventId: 1, status: 1, listedAt: -1 });
ResaleListingSchema.index({ sellerUserId: 1, status: 1 });

export default mongoose.model<IResaleListing>('ResaleListing', ResaleListingSchema);
