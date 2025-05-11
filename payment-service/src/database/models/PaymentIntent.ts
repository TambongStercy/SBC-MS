import mongoose, { Schema } from 'mongoose';
import { IPaymentIntent, PaymentStatus, PaymentGateway } from '../interfaces/IPaymentIntent';
import { nanoid } from 'nanoid'; // Using nanoid for generating sessionId

const PaymentIntentSchema: Schema = new Schema(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            default: () => nanoid(12), // Generate a unique 12-char ID
        },
        userId: {
            type: String, // Assuming User ID is a string. Change to mongoose.Schema.Types.ObjectId if linking to a User collection
            required: true,
            index: true,
        },
        paymentType: { // Added field
            type: String,
            index: true,
        },
        subscriptionType: {
            type: String,
        },
        subscriptionPlan: {
            type: String,
        },
        amount: {
            type: Number,
        },
        currency: {
            type: String,
        },
        phoneNumber: {
            type: String,
        },
        countryCode: {
            type: String, // Store the country code (e.g., 'BJ', 'CM')
        },
        operator: {
            type: String, // Store the payment operator slug (e.g., 'mtn', 'orange_ci')
            index: true, // Optional: index if you query by operator often
        },
        status: {
            type: String,
            enum: Object.values(PaymentStatus),
            default: PaymentStatus.PENDING_USER_INPUT,
            required: true,
            index: true,
        },
        gateway: {
            type: String,
            enum: Object.values(PaymentGateway),
            default: PaymentGateway.NONE,
            required: true,
        },
        gatewayPaymentId: { // ID/Reference from Feexpay/Lygos
            type: String,
            index: true,
        },
        gatewayCheckoutUrl: { // URL provided by Feexpay/Lygos for user payment
            type: String,
        },
        gatewayRawResponse: {
            type: Schema.Types.Mixed, // Store the raw response for debugging
        },
        // Optional: Store final payment details after conversion
        paidAmount: {
            type: Number,
        },
        paidCurrency: {
            type: String,
        },
        webhookHistory: [
            {
                timestamp: { type: Date, default: Date.now },
                status: { type: String, enum: Object.values(PaymentStatus) },
                providerData: { type: Schema.Types.Mixed },
            },
        ],
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt automatically
    }
);

// Index for efficient querying by provider reference
PaymentIntentSchema.index({ gateway: 1, gatewayPaymentId: 1 }, { sparse: true });

export default mongoose.model<IPaymentIntent>('PaymentIntent', PaymentIntentSchema); 