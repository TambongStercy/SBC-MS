import mongoose, { Document, Schema, Types } from 'mongoose';

export enum CommissionKind {
    PRIMARY = 'PRIMARY',
    RESALE = 'RESALE',
}

export interface ICommission extends Document {
    _id: Types.ObjectId;
    kind: CommissionKind;
    orderId?: Types.ObjectId;
    resaleOrderId?: Types.ObjectId;
    eventId: Types.ObjectId;
    basisAmount: number;
    rate: number;
    amount: number;
    sbcRevenueBookedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const CommissionSchema = new Schema<ICommission>({
    kind: { type: String, enum: Object.values(CommissionKind), required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true, sparse: true },
    resaleOrderId: { type: Schema.Types.ObjectId, ref: 'ResaleOrder', index: true, sparse: true },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    basisAmount: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    sbcRevenueBookedAt: { type: Date, required: true, default: () => new Date() },
}, { timestamps: true });

CommissionSchema.index({ sbcRevenueBookedAt: -1 });

export default mongoose.model<ICommission>('Commission', CommissionSchema);
