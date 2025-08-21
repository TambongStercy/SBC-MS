import { Schema, Document, Types, model } from 'mongoose';

export enum RecoveryStatus {
    NOT_RESTORED = 'not_restored',
    RESTORED = 'restored'
}

export enum RecoveryProvider {
    CINETPAY = 'cinetpay',
    FEEXPAY = 'feexpay'
}

export enum RecoveryTransactionType {
    PAYMENT = 'payment',      // PaymentIntent (deposits/subscriptions)
    PAYOUT = 'payout'        // Transaction withdrawals
}

// Interface defining the RecoverUserTransaction document structure
export interface IRecoverUserTransaction extends Document {
    _id: Types.ObjectId;
    // Transaction identifiers
    transactionReference: string;    // Original provider transaction/session/reference ID
    provider: RecoveryProvider;
    transactionType: RecoveryTransactionType;
    
    // User information from provider
    userEmail?: string;
    userPhoneNumber?: string;
    userIdFromProvider?: string;     // Provider-specific user ID if available
    
    // Transaction details from provider
    amount: number;
    currency: string;
    status: string;                  // Original provider status
    providerTransactionData: Record<string, any>; // Full transaction data from provider
    
    // Recovery status
    recoveryStatus: RecoveryStatus;
    restoredUserId?: Types.ObjectId;   // Set when user is restored
    restoredTransactionId?: string;    // Set when transaction/paymentIntent is restored
    restoredAt?: Date;
    
    // Metadata
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

// RecoverUserTransaction Schema
const RecoverUserTransactionSchema = new Schema<IRecoverUserTransaction>(
    {
        transactionReference: {
            type: String,
            required: true,
            index: true
        },
        provider: {
            type: String,
            enum: Object.values(RecoveryProvider),
            required: true,
            index: true
        },
        transactionType: {
            type: String,
            enum: Object.values(RecoveryTransactionType),
            required: true,
            index: true
        },
        userEmail: {
            type: String,
            index: true,
            sparse: true
        },
        userPhoneNumber: {
            type: String,
            index: true,
            sparse: true
        },
        userIdFromProvider: {
            type: String,
            index: true,
            sparse: true
        },
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            required: true
        },
        status: {
            type: String,
            required: true
        },
        providerTransactionData: {
            type: Schema.Types.Mixed,
            required: true
        },
        recoveryStatus: {
            type: String,
            enum: Object.values(RecoveryStatus),
            default: RecoveryStatus.NOT_RESTORED,
            required: true,
            index: true
        },
        restoredUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
            sparse: true
        },
        restoredTransactionId: {
            type: String,
            index: true,
            sparse: true
        },
        restoredAt: {
            type: Date
        },
        metadata: {
            type: Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Create compound indexes for efficient queries
RecoverUserTransactionSchema.index({ provider: 1, transactionReference: 1 }, { unique: true });
RecoverUserTransactionSchema.index({ userEmail: 1, recoveryStatus: 1 });
RecoverUserTransactionSchema.index({ userPhoneNumber: 1, recoveryStatus: 1 });
RecoverUserTransactionSchema.index({ recoveryStatus: 1, createdAt: -1 });

// Model Export
const RecoverUserTransactionModel = model<IRecoverUserTransaction>('RecoverUserTransaction', RecoverUserTransactionSchema);

export default RecoverUserTransactionModel;