import mongoose, { Document, Schema, Types } from 'mongoose';

export enum CommissionKind {
    PRIMARY = 'PRIMARY',
    RESALE = 'RESALE',
    /** SBC's share of a paid vote pack (animation module). */
    VOTE = 'VOTE',
}

export interface ICommission extends Document {
    _id: Types.ObjectId;
    kind: CommissionKind;
    orderId?: Types.ObjectId;
    resaleOrderId?: Types.ObjectId;
    voteTransactionId?: Types.ObjectId;
    /** Set when the sale was refunded: SBC gave this commission back. */
    reversedAt?: Date;
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
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    resaleOrderId: { type: Schema.Types.ObjectId, ref: 'ResaleOrder' },
    voteTransactionId: { type: Schema.Types.ObjectId },
    reversedAt: { type: Date },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    basisAmount: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    sbcRevenueBookedAt: { type: Date, required: true, default: () => new Date() },
}, { timestamps: true });

CommissionSchema.index({ sbcRevenueBookedAt: -1 });
// One commission per sale: a replayed webhook must not book SBC revenue twice.
// Existing databases need scripts/migrate-commission-unique-indexes.ts first —
// it drops the old non-unique orderId_1 / resaleOrderId_1 and reports duplicates.
CommissionSchema.index(
    { orderId: 1 },
    { unique: true, name: 'uniq_primary_orderId', partialFilterExpression: { kind: CommissionKind.PRIMARY, orderId: { $exists: true } } },
);
CommissionSchema.index(
    { voteTransactionId: 1 },
    { unique: true, name: 'uniq_voteTransactionId', partialFilterExpression: { voteTransactionId: { $exists: true } } },
);
CommissionSchema.index(
    { resaleOrderId: 1 },
    { unique: true, name: 'uniq_resaleOrderId', partialFilterExpression: { resaleOrderId: { $exists: true } } },
);

export default mongoose.model<ICommission>('Commission', CommissionSchema);
