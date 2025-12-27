import mongoose, { Schema, Document } from 'mongoose';

/**
 * Interface for External Gateway Balance
 * Tracks the actual money in external payment gateways
 */
export interface IGatewayBalance extends Document {
    // Gateway balances entered by admin
    nowpaymentsBalanceUSD: number;  // NOWPayments balance in USD (crypto gateway)
    feexpayBalanceXAF: number;      // FeexPay balance in XAF
    cinetpayBalanceXAF: number;     // CinetPay balance in XAF

    // Metadata
    lastUpdatedBy: mongoose.Types.ObjectId;  // Admin who last updated
    notes?: string;                          // Optional notes from admin

    createdAt: Date;
    updatedAt: Date;
}

/**
 * Interface for Gateway Balance History (for auditing)
 */
export interface IGatewayBalanceHistory extends Document {
    nowpaymentsBalanceUSD: number;
    feexpayBalanceXAF: number;
    cinetpayBalanceXAF: number;
    updatedBy: mongoose.Types.ObjectId;
    notes?: string;
    createdAt: Date;
}

const GatewayBalanceSchema: Schema = new Schema(
    {
        nowpaymentsBalanceUSD: { type: Number, default: 0, required: true },
        feexpayBalanceXAF: { type: Number, default: 0, required: true },
        cinetpayBalanceXAF: { type: Number, default: 0, required: true },
        lastUpdatedBy: { type: Schema.Types.ObjectId, required: true },
        notes: { type: String, trim: true },
    },
    {
        timestamps: true,
        versionKey: false,
        collection: 'gateway_balances'
    }
);

const GatewayBalanceHistorySchema: Schema = new Schema(
    {
        nowpaymentsBalanceUSD: { type: Number, required: true },
        feexpayBalanceXAF: { type: Number, required: true },
        cinetpayBalanceXAF: { type: Number, required: true },
        updatedBy: { type: Schema.Types.ObjectId, required: true },
        notes: { type: String, trim: true },
    },
    {
        timestamps: { createdAt: true, updatedAt: false }, // Only track createdAt
        versionKey: false,
        collection: 'gateway_balance_history'
    }
);

// Create indexes for efficient queries
GatewayBalanceHistorySchema.index({ createdAt: -1 });

export const GatewayBalanceModel = mongoose.model<IGatewayBalance>('GatewayBalance', GatewayBalanceSchema);
export const GatewayBalanceHistoryModel = mongoose.model<IGatewayBalanceHistory>('GatewayBalanceHistory', GatewayBalanceHistorySchema);
