import { Schema, Document, Types, model, Query } from 'mongoose';

// Define Transaction Status
export enum TransactionStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    REFUNDED = 'refunded',
    PROCESSING = 'processing',
    PENDING_OTP_VERIFICATION = 'pending_otp_verification',
}

// Define Transaction Type
export enum TransactionType {
    DEPOSIT = 'deposit',
    WITHDRAWAL = 'withdrawal',
    TRANSFER = 'transfer',
    PAYMENT = 'payment',
    REFUND = 'refund',
    FEE = 'fee',
}

// Define Currency
export enum Currency {
    XAF = 'XAF',  // Central African CFA franc
    XOF = 'XOF', // West African CFA franc
    USD = 'USD',
    EUR = 'EUR',
    GBP = 'GBP',
}

// Interface for Payment Provider Data
interface IPaymentProviderData {
    provider: string;
    transactionId: string;
    status: string;
    metadata?: Record<string, any>;
}

// Interface defining the Transaction document structure
export interface ITransaction extends Document {
    _id: Types.ObjectId;
    transactionId: string;
    userId: Types.ObjectId;
    type: TransactionType;
    amount: number;
    currency: Currency;
    fee: number;
    status: TransactionStatus;
    description: string;
    metadata?: Record<string, any>;
    paymentProvider?: IPaymentProviderData;
    relatedTransactions?: Types.ObjectId[];
    ipAddress?: string;
    deviceInfo?: string;
    deleted: boolean;
    deletedAt?: Date;
    createdAt: Date;
    updatedAt: Date;

    // Link to pending record for OTP (retained, but no longer used for withdrawals directly)
    pendingId?: Types.ObjectId | string;

    // --- Added Fields for OTP/Verification directly on Transaction ---
    verificationCode?: string;     // Store OTP for this transaction
    verificationExpiry?: Date;     // Expiry for the OTP

    // --- Added Fields --- 
    reference?: string;           // Optional general reference
    serviceProvider?: string;     // Optional specific service provider (e.g., mobile money operator)
    paymentMethod?: string;       // Optional specific payment method (e.g., 'MTN', 'ORANGE_MONEY')
    externalTransactionId?: string; // Optional ID from external system/provider
}

// Payment Provider Data Schema
const PaymentProviderDataSchema = new Schema({
    provider: { type: String, required: true },
    transactionId: { type: String, required: true },
    status: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
}, { _id: false });

// Transaction Schema
const TransactionSchema = new Schema<ITransaction>(
    {
        transactionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(TransactionType),
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            enum: Object.values(Currency),
            required: true,
            default: Currency.XAF,
        },
        fee: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: Object.values(TransactionStatus),
            default: TransactionStatus.PENDING,
            required: true,
            index: true,
        },
        description: {
            type: String,
            required: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
        paymentProvider: PaymentProviderDataSchema,
        relatedTransactions: [{
            type: Schema.Types.ObjectId,
            ref: 'Transaction',
        }],
        ipAddress: {
            type: String,
        },
        deviceInfo: {
            type: String,
        },
        deleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
        },
        // --- Added Fields --- 
        reference: {
            type: String,
            index: true
        },
        serviceProvider: {
            type: String,
            index: true
        },
        paymentMethod: {
            type: String,
            index: true
        },
        externalTransactionId: {
            type: String,
            index: true
        },
        pendingId: { // This field is no longer directly used for withdrawals but kept for other flows.
            type: Schema.Types.ObjectId,
            ref: 'Pending',
        },
        // New fields for OTP management directly on transaction
        verificationCode: { // Store OTP for this transaction
            type: String,
            select: false, // Do not return by default for security
        },
        verificationExpiry: { // Expiry for the OTP
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// --- Soft Delete Query Middleware --- 
const softDeleteMiddleware = function (this: Query<any, ITransaction>, next: any) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
};

TransactionSchema.pre('find', softDeleteMiddleware);
TransactionSchema.pre('findOne', softDeleteMiddleware);
TransactionSchema.pre('countDocuments', softDeleteMiddleware);
TransactionSchema.pre('findOneAndUpdate', softDeleteMiddleware);
TransactionSchema.pre('updateMany', softDeleteMiddleware);
TransactionSchema.pre('updateOne', softDeleteMiddleware);

// Create compound indexes for common queries
TransactionSchema.index({ userId: 1, type: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });

// Model Export
const TransactionModel = model<ITransaction>('Transaction', TransactionSchema);

export default TransactionModel; 