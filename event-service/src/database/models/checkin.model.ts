import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICheckIn extends Document {
    _id: Types.ObjectId;
    ticketId: Types.ObjectId;
    eventId: Types.ObjectId;
    scannedByUserId: Types.ObjectId;
    deviceInfo?: string;
    scannedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const CheckInSchema = new Schema<ICheckIn>({
    // Unique per ticket — the DB is the last line of defence against double check-in.
    ticketId: { type: Schema.Types.ObjectId, required: true, ref: 'Ticket', unique: true },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    scannedByUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    deviceInfo: { type: String, maxlength: 300 },
    scannedAt: { type: Date, required: true, default: () => new Date() },
}, { timestamps: true });

CheckInSchema.index({ eventId: 1, scannedAt: -1 });

export default mongoose.model<ICheckIn>('CheckIn', CheckInSchema);
