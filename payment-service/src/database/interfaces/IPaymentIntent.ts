import { Document } from 'mongoose';

export enum PaymentStatus {
    PENDING_USER_INPUT = 'PENDING_USER_INPUT', // Initial state, waiting for user details on custom page
    PENDING_PROVIDER = 'PENDING_PROVIDER',   // Request sent to Feexpay/Lygos, awaiting user action on their page
    PROCESSING = 'PROCESSING',           // Payment is being processed by the provider
    SUCCEEDED = 'SUCCEEDED',             // Payment confirmed successfully
    FAILED = 'FAILED',                 // Payment failed
    CANCELED = 'CANCELED',               // Payment explicitly canceled (if applicable)
    REQUIRES_ACTION = 'REQUIRES_ACTION',  // Provider requires additional action (e.g., 3DS)
    ERROR = 'ERROR',
    // Crypto-specific statuses
    WAITING_FOR_CRYPTO_DEPOSIT = 'WAITING_FOR_CRYPTO_DEPOSIT', // Waiting for user to send crypto
    PARTIALLY_PAID = 'PARTIALLY_PAID',   // Payment partially received
    CONFIRMED = 'CONFIRMED',             // Crypto payment confirmed on blockchain
    EXPIRED = 'EXPIRED'                  // Payment window expired
}

export enum PaymentGateway {
    NONE = 'none',
    FEEXPAY = 'feexpay',
    CINETPAY = 'cinetpay',
    LYGOS = 'lygos',
    STRIPE = 'stripe', // Example if you add Stripe later
    NOWPAYMENTS = 'nowpayments', // Added NOWPayments for crypto
    TESTING = 'testing' // Added for testing purposes
}

export interface IPaymentIntent extends Document {
    sessionId: string; // Unique identifier for this payment flow
    userId: string; // Reference to the User initiating the payment
    paymentType?: string; // Optional: Purpose ('SUBSCRIPTION', 'FLASH_SALE_FEE', etc.)

    // Subscription specific (consider moving to metadata?)
    subscriptionType?: string; // e.g., 'premium', 'basic'
    subscriptionPlan?: string; // e.g., 'monthly', 'annual'

    amount?: number; // To be filled when user provides details
    currency?: string; // e.g., 'XOF', 'KES', 'USD', 'BTC', 'ETH', 'USDT' - To be filled when user provides details
    phoneNumber?: string; // To be filled when user provides details
    countryCode?: string; // e.g., 'BJ', 'CM', 'CI' - To be filled, used for gateway selection
    operator?: string; // Optional: Payment operator slug (e.g., 'mtn', 'orange_ci')

    // Crypto-specific fields
    payCurrency?: string; // Crypto currency for payment (e.g., 'BTC', 'ETH', 'USDT')
    payAmount?: number; // Amount in crypto currency
    cryptoAddress?: string; // Crypto deposit address
    cryptoQrCode?: string; // QR code for crypto payment
    exchangeRate?: number; // Exchange rate from fiat to crypto
    networkFee?: number; // Network fee for crypto transaction
    minConfirmations?: number; // Required confirmations for crypto payment
    expiresAt?: Date; // Payment expiration time for crypto

    status: PaymentStatus; // Current status of the payment intent
    gateway: PaymentGateway; // Which gateway was used (or NONE initially)
    gatewayPaymentId?: string; // Transaction ID/Reference from the payment provider
    gatewayCheckoutUrl?: string; // URL for user redirection provided by the gateway
    gatewayRawResponse?: object; // Store the last raw response from the gateway for debugging

    // Optional: Store final payment details after conversion
    paidAmount?: number;
    paidCurrency?: string;

    webhookHistory: { timestamp: Date; status: PaymentStatus; providerData?: any }[]; // Log of webhook events

    metadata?: Record<string, any>; // Any other relevant data

    createdAt: Date;
    updatedAt: Date;
} 