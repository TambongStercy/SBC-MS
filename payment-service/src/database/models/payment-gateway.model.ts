import { Schema, Document, model } from 'mongoose';

// Define Payment Gateway Status
export enum GatewayStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    MAINTENANCE = 'maintenance',
    DEPRECATED = 'deprecated',
}

// Define Payment Gateway Type
export enum GatewayType {
    CREDIT_CARD = 'credit_card',
    MOBILE_MONEY = 'mobile_money',
    BANK_TRANSFER = 'bank_transfer',
    CRYPTOCURRENCY = 'cryptocurrency',
    DIGITAL_WALLET = 'digital_wallet',
}

// Interface defining the Payment Gateway document structure
export interface IPaymentGateway extends Document {
    name: string;
    identifier: string;
    type: GatewayType;
    status: GatewayStatus;
    description: string;
    credentials: Record<string, any>;
    settings: Record<string, any>;
    supportedCurrencies: string[];
    countries: string[];
    minAmount?: number;
    maxAmount?: number;
    feeStructure: {
        percentage?: number;
        fixed?: number;
        minFee?: number;
        maxFee?: number;
    };
    webhookUrl?: string;
    callbackUrl?: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

// Payment Gateway Schema
const PaymentGatewaySchema = new Schema<IPaymentGateway>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        identifier: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(GatewayType),
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(GatewayStatus),
            default: GatewayStatus.INACTIVE,
            required: true,
            index: true,
        },
        description: {
            type: String,
            required: true,
        },
        credentials: {
            type: Schema.Types.Mixed,
            required: true,
            select: false, // Don't include in queries by default for security
        },
        settings: {
            type: Schema.Types.Mixed,
            default: {},
        },
        supportedCurrencies: {
            type: [String],
            required: true,
        },
        countries: {
            type: [String],
            required: true,
        },
        minAmount: {
            type: Number,
        },
        maxAmount: {
            type: Number,
        },
        feeStructure: {
            percentage: {
                type: Number,
                default: 0,
            },
            fixed: {
                type: Number,
                default: 0,
            },
            minFee: {
                type: Number,
                default: 0,
            },
            maxFee: {
                type: Number,
            },
        },
        webhookUrl: {
            type: String,
        },
        callbackUrl: {
            type: String,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

// Create indexes for common queries
PaymentGatewaySchema.index({ status: 1, type: 1 });
PaymentGatewaySchema.index({ supportedCurrencies: 1, status: 1 });
PaymentGatewaySchema.index({ countries: 1, status: 1 });

// Model Export
const PaymentGatewayModel = model<IPaymentGateway>('PaymentGateway', PaymentGatewaySchema);

export default PaymentGatewayModel; 