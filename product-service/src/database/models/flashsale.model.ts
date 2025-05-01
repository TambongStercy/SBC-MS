import { Schema, Document, Types, model } from 'mongoose';

// Enum for Flash Sale Status
export enum FlashSaleStatus {
    PENDING_PAYMENT = 'pending_payment', // Waiting for seller fee payment
    SCHEDULED = 'scheduled',       // Fee paid, waiting for startTime
    ACTIVE = 'active',           // Currently running
    EXPIRED = 'expired',         // EndTime passed
    CANCELLED = 'cancelled',       // Manually cancelled
    PAYMENT_FAILED = 'payment_failed' // Seller fee payment failed
}

// Interface defining the FlashSale document structure
export interface IFlashSale extends Document {
    _id: Types.ObjectId;
    productId: Types.ObjectId;       // Reference to the Product
    sellerUserId: Types.ObjectId;    // Reference to the User (product owner)
    originalPrice: number;         // Price of the product when sale was created
    discountedPrice: number;       // The flash sale price
    startTime: Date;               // When the sale becomes active
    endTime: Date;                 // When the sale ends
    status: FlashSaleStatus;       // Current status of the sale
    feePaymentIntentId?: string;   // ID from payment-service for the 300 FCFA fee
    feePaymentStatus: 'pending' | 'succeeded' | 'failed'; // Status of the seller fee payment
    viewCount: number;             // <-- Add view count
    whatsappClickCount: number;    // <-- Add click count
    createdAt: Date;
    updatedAt: Date;
}

const FlashSaleSchema = new Schema<IFlashSale>(
    {
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
            index: true
        },
        sellerUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User', // Assuming User refs are needed/possible here
            required: true,
            index: true
        },
        originalPrice: {
            type: Number,
            required: true,
            min: 0
        },
        discountedPrice: {
            type: Number,
            required: true,
            min: 0
        },
        startTime: {
            type: Date,
            required: true,
            index: true
        },
        endTime: {
            type: Date,
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: Object.values(FlashSaleStatus),
            default: FlashSaleStatus.PENDING_PAYMENT,
            required: true,
            index: true
        },
        feePaymentIntentId: {
            type: String,
            index: true // Index for potential lookups based on payment intent
        },
        feePaymentStatus: {
            type: String,
            enum: ['pending', 'succeeded', 'failed'],
            default: 'pending',
            required: true
        },
        viewCount: {             // <-- Add view count schema
            type: Number,
            default: 0,
            min: 0
        },
        whatsappClickCount: {    // <-- Add click count schema
            type: Number,
            default: 0,
            min: 0
        }
    },
    {
        timestamps: true // Adds createdAt and updatedAt automatically
    }
);

// Index for active sales query
FlashSaleSchema.index({ status: 1, startTime: 1, endTime: 1 });
// Index for seller's sales
FlashSaleSchema.index({ sellerUserId: 1, status: 1 });

const FlashSaleModel = model<IFlashSale>('FlashSale', FlashSaleSchema);

export default FlashSaleModel; 