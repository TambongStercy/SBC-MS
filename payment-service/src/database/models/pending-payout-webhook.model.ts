import { Schema, Document, model } from 'mongoose';

/**
 * Buffers payout webhook payloads that arrive BEFORE the initiation flow has
 * finished storing the provider's tokenPay on the transaction row. Without
 * this, MoneyFusion's habit of firing the webhook the same instant they
 * return tokenPay in the /withdraw response races our own DB write and every
 * "arrived-too-early" webhook is silently dropped.
 *
 * Flow:
 *   1. Webhook arrives, handler queries transaction by tokenPay, finds nothing
 *   2. Handler inserts a document here { tokenPay, provider, payload } and
 *      returns 200 to the provider (so they don't retry-storm us)
 *   3. Our initiation code eventually finishes storing tokenPay on the tx
 *      and calls the sweep, which pulls the matching pending row and replays
 *      the original webhook payload through the normal handler
 *   4. On success the pending row is marked processed. The TTL index expires
 *      the row after 7 days regardless — safety net against orphans.
 */
export interface IPendingPayoutWebhook extends Document {
    tokenPay: string;
    provider: 'MoneyFusion' | 'CinetPay' | 'FeexPay';
    payload: any;
    receivedAt: Date;
    processed: boolean;
    processedAt?: Date;
    replayAttempts: number;
    lastReplayError?: string;
}

const PendingPayoutWebhookSchema = new Schema<IPendingPayoutWebhook>(
    {
        tokenPay: { type: String, required: true, index: true },
        provider: { type: String, required: true, enum: ['MoneyFusion', 'CinetPay', 'FeexPay'] },
        payload: { type: Schema.Types.Mixed, required: true },
        receivedAt: { type: Date, default: Date.now, index: true },
        processed: { type: Boolean, default: false, index: true },
        processedAt: { type: Date },
        replayAttempts: { type: Number, default: 0 },
        lastReplayError: { type: String },
    },
    {
        timestamps: true,
        collection: 'pendingpayoutwebhooks',
    }
);

// TTL: auto-purge rows 7 days after receivedAt. Successful replays get marked
// processed but the record stays for audit until TTL fires. If a webhook never
// finds its tx (e.g. an entirely rogue tokenPay from a mis-routed provider
// message), the entry expires on its own.
PendingPayoutWebhookSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

const PendingPayoutWebhookModel = model<IPendingPayoutWebhook>('PendingPayoutWebhook', PendingPayoutWebhookSchema);

export default PendingPayoutWebhookModel;
