import mongoose, { Document, Schema, Types } from 'mongoose';

export enum TicketTypeStatus {
    ACTIVE = 'ACTIVE',
    SOLD_OUT = 'SOLD_OUT',
    DISABLED = 'DISABLED',
}

export interface ITicketType extends Document {
    _id: Types.ObjectId;
    eventId: Types.ObjectId;
    name: string;
    description?: string;
    price: number; // XAF
    quantityTotal: number;
    /**
     * Sold counter incremented atomically at settlement. Never write with JS
     * check-then-set — use TicketType.updateOne with a $lte guard on the increment.
     */
    quantitySold: number;
    maxPerOrder: number;
    salesStart?: Date;
    salesEnd?: Date;
    status: TicketTypeStatus;
    createdAt: Date;
    updatedAt: Date;
}

const TicketTypeSchema = new Schema<ITicketType>({
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, maxlength: 500 },
    price: { type: Number, required: true, min: 0 },
    quantityTotal: { type: Number, required: true, min: 0 },
    quantitySold: { type: Number, default: 0, min: 0 },
    maxPerOrder: { type: Number, default: 10, min: 1 },
    salesStart: { type: Date },
    salesEnd: { type: Date },
    status: { type: String, enum: Object.values(TicketTypeStatus), default: TicketTypeStatus.ACTIVE },
}, { timestamps: true });

TicketTypeSchema.index({ eventId: 1, status: 1 });

export default mongoose.model<ITicketType>('TicketType', TicketTypeSchema);
