import { Schema, Document, Types, model } from 'mongoose';
import { TransactionType, Currency } from './transaction.model';

// Define Pending Transaction Status
export enum PendingStatus {
    AWAITING_VERIFICATION = 'awaiting_verification',
    AWAITING_PAYMENT = 'awaiting_payment',
    PROCESSING = 'processing',
    HOLD = 'hold',
    EXPIRED = 'expired',
    FAILED = 'failed',
    VERIFIED = 'verified',
}

// Define Verification Type
export enum VerificationType {
    NONE = 'none',
    OTP = 'otp',
    ADMIN = 'admin',
    KYC = 'kyc',
}

// Interface defining the Pending Transaction document structure
export interface IPending extends Document {
    pendingId: string;
    userId: Types.ObjectId;
    transactionType: TransactionType;
    amount: number;
    currency: Currency;
    status: PendingStatus;
    verificationType: VerificationType;
    verificationCode?: string;
    verificationExpiry?: Date;
    description: string;
    metadata?: Record<string, any>;
    callbackUrl?: string;
    ipAddress?: string;
    deviceInfo?: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Pending Transaction Schema
const PendingSchema = new Schema<IPending>(
    {
        pendingId: {
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
        transactionType: {
            type: String,
            enum: Object.values(TransactionType),
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            enum: Object.values(Currency),
            required: true,
            default: Currency.USD,
        },
        status: {
            type: String,
            enum: Object.values(PendingStatus),
            default: PendingStatus.AWAITING_VERIFICATION,
            required: true,
            index: true,
        },
        verificationType: {
            type: String,
            enum: Object.values(VerificationType),
            default: VerificationType.NONE,
            required: true,
        },
        verificationCode: {
            type: String,
            select: false, // Don't include in queries by default for security
        },
        verificationExpiry: {
            type: Date,
        },
        description: {
            type: String,
            required: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
        callbackUrl: {
            type: String,
        },
        ipAddress: {
            type: String,
        },
        deviceInfo: {
            type: String,
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Create compound indexes for common queries
PendingSchema.index({ userId: 1, status: 1, createdAt: -1 });
PendingSchema.index({ expiresAt: 1, status: 1 });
PendingSchema.index({ pendingId: 1, verificationCode: 1 });

// Model Export
const PendingModel = model<IPending>('Pending', PendingSchema);

export default PendingModel; 