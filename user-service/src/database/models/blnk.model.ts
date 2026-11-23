import { Schema, Types, model } from 'mongoose';
import { WALLET_CURRENCIES } from './wallet-movement.model';

/**
 * Security plan Phase 2: the Mongo side of the second ledger (Blnk).
 *   - blnk_balances: each member's Blnk balance per currency (no personal data
 *     goes to Blnk, only the userId in meta_data).
 *   - blnk_syncs: what happened to each wallet movement in Blnk (outbox state).
 *     Kept apart from walletmovements, which nothing updates once APPLIED.
 *   - blnk_state: the sync cursor and the ledger id.
 */
const BlnkBalanceSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true },
    currency: { type: String, enum: WALLET_CURRENCIES, required: true },
    balanceId: { type: String, required: true },
    openingPosted: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
}, { collection: 'blnk_balances', versionKey: false });
BlnkBalanceSchema.index({ userId: 1, currency: 1 }, { unique: true });
export const BlnkBalanceModel = model('BlnkBalance', BlnkBalanceSchema);

export type BlnkSyncStatus = 'synced' | 'skipped_zero' | 'skipped_in_opening' | 'skipped_stuck_pending' | 'rejected';
const BlnkSyncSchema = new Schema({
    movementId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    currency: { type: String, required: true },
    reference: { type: String, required: true },
    direction: { type: String, required: true },
    amount: { type: Number, required: true },
    counterpart: { type: String, default: null },
    status: { type: String, required: true },
    txId: { type: String, default: null },
    error: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
}, { collection: 'blnk_syncs', versionKey: false });
BlnkSyncSchema.index({ movementId: 1 }, { unique: true });
BlnkSyncSchema.index({ status: 1, at: -1 });
BlnkSyncSchema.index({ userId: 1, currency: 1 });
export const BlnkSyncModel = model('BlnkSync', BlnkSyncSchema);

const BlnkStateSchema = new Schema({ _id: String, value: Schema.Types.Mixed, at: Date }, { collection: 'blnk_state', versionKey: false });
export const BlnkStateModel = model('BlnkState', BlnkStateSchema);

export type ObjectIdLike = Types.ObjectId | string;
