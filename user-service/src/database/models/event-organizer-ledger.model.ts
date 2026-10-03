import { Schema, Document, Types, model } from 'mongoose';

/**
 * One row per movement of eventOrganizerBalance requested by event-service
 * (ticket sale, resale share, paid votes, refunds). The unique
 * {reference, direction} is what makes a replayed credit or debit a no-op:
 * webhooks, reconcilers and sweepers all retry, and the balance must move once.
 *
 * APPLIED: the balance moved. PENDING only exists on the non-transactional
 * fallback, between the ledger insert and the $inc; a PENDING row that stays
 * PENDING means a crash in that window and needs a human to check the balance.
 */
export enum EventOrganizerLedgerDirection {
    CREDIT = 'CREDIT',
    DEBIT = 'DEBIT',
}

export enum EventOrganizerLedgerStatus {
    PENDING = 'PENDING',
    APPLIED = 'APPLIED',
}

export interface IEventOrganizerLedger extends Document {
    reference: string;
    direction: EventOrganizerLedgerDirection;
    userId: Types.ObjectId;
    amount: number;
    description?: string;
    status: EventOrganizerLedgerStatus;
    createdAt: Date;
    updatedAt: Date;
}

const EventOrganizerLedgerSchema = new Schema<IEventOrganizerLedger>(
    {
        reference: { type: String, required: true, maxlength: 200 },
        direction: { type: String, enum: Object.values(EventOrganizerLedgerDirection), required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        description: { type: String, maxlength: 500 },
        status: { type: String, enum: Object.values(EventOrganizerLedgerStatus), required: true },
    },
    { timestamps: true },
);

EventOrganizerLedgerSchema.index({ reference: 1, direction: 1 }, { unique: true });
EventOrganizerLedgerSchema.index({ status: 1, createdAt: 1 });

export default model<IEventOrganizerLedger>('EventOrganizerLedger', EventOrganizerLedgerSchema);
