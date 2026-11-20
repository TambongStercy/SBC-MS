import mongoose, { Schema, Document } from 'mongoose';

/**
 * Security plan Phase 10: team alerts on payments (provider drop, error spike,
 * stuck payments). One open alert per key; it closes when the condition
 * clears, and a new one opens if it comes back. Kept (never deleted) so the
 * dashboard can show the history.
 */
export type PaymentAlertKind = 'provider_drop' | 'country_error_spike' | 'sbc_code_spike' | 'provider_api_spike' | 'stuck_payments';

export interface IPaymentAlert extends Document {
    key: string;
    kind: PaymentAlertKind;
    gateway?: string;
    country?: string;
    title: string;
    details: Record<string, unknown>;
    openedAt: Date;
    lastSeenAt: Date;
    resolvedAt?: Date | null;
    notifiedAt?: Date | null;
    /** True while open: at most one open alert per key (partial unique index). */
    open: boolean;
}

const PaymentAlertSchema = new Schema<IPaymentAlert>({
    key: { type: String, required: true },
    kind: { type: String, required: true },
    gateway: String,
    country: String,
    title: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
    openedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
    open: { type: Boolean, required: true, default: true },
}, { timestamps: false });

PaymentAlertSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { open: true } });
PaymentAlertSchema.index({ openedAt: -1 });

export default mongoose.model<IPaymentAlert>('PaymentAlert', PaymentAlertSchema, 'paymentalerts');
