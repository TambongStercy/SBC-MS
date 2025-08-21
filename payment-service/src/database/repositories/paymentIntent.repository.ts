import { Types } from 'mongoose';
import { nanoid } from 'nanoid';
import PaymentIntent from '../models/PaymentIntent';
import { IPaymentIntent, PaymentStatus, PaymentGateway } from '../interfaces/IPaymentIntent';
import logger from '../../utils/logger';
import { FilterQuery, QueryOptions, SortOrder } from 'mongoose';

const log = logger.getLogger('PaymentIntentRepository');

// Interface for creating a new payment intent
export interface CreatePaymentIntentInput {
    userId: string;
    amount: number;
    currency: string;
    paymentType?: string; // Optional: Purpose ('SUBSCRIPTION', 'FLASH_SALE_FEE', etc.)

    // Subscription specific (required if paymentType is SUBSCRIPTION)
    subscriptionType?: string;
    subscriptionPlan?: string;

    // Optional fields
    status?: PaymentStatus;
    gateway?: PaymentGateway;
    phoneNumber?: string;
    countryCode?: string;
    metadata?: Record<string, any>;
    gatewayPaymentId?: string;
    gatewayRawResponse?: any;
}

// Interface for updating a payment intent
export interface UpdatePaymentIntentInput {
    status?: PaymentStatus;
    gateway?: PaymentGateway;
    gatewayPaymentId?: string;
    gatewayCheckoutUrl?: string;
    gatewayRawResponse?: any;
    phoneNumber?: string;
    countryCode?: string;
    operator?: string;
    metadata?: Record<string, any>;
    webhookHistory?: Array<{
        timestamp: Date;
        status: PaymentStatus;
        providerData?: any;
    }>;
    paidAmount?: number;
    paidCurrency?: string;
    
    // Crypto-specific fields
    payCurrency?: string; // Crypto currency for payment (e.g., 'BTC', 'ETH', 'USDT')
    payAmount?: number; // Amount in crypto currency
    cryptoAddress?: string; // Crypto deposit address
    cryptoQrCode?: string; // QR code for crypto payment
    exchangeRate?: number; // Exchange rate from fiat to crypto
    networkFee?: number; // Network fee for crypto transaction
    minConfirmations?: number; // Required confirmations for crypto payment
    expiresAt?: Date; // Payment expiration time for crypto
    
    // Additional fields that might be updated
    amount?: number;
    currency?: string;
}

// Define structure for pagination options used internally
interface PaginationOptions {
    page: number;
    limit: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// Payment Intent repository for handling database operations
class PaymentIntentRepository {
    private model = PaymentIntent; // Keep reference to the model

    /**
     * Create a new payment intent
     */
    async create(input: CreatePaymentIntentInput): Promise<IPaymentIntent> {
        try {
            // Generate a unique session ID for tracking this payment
            const sessionId = nanoid(12);

            const paymentIntent = await this.model.create({
                sessionId,
                userId: input.userId,
                subscriptionType: input.subscriptionType,
                subscriptionPlan: input.subscriptionPlan,
                amount: input.amount,
                currency: input.currency,
                status: input.status || PaymentStatus.PENDING_USER_INPUT,
                gateway: input.gateway || PaymentGateway.NONE,
                phoneNumber: input.phoneNumber,
                countryCode: input.countryCode,
                metadata: input.metadata,
                webhookHistory: []
            });

            log.info(`Created payment intent ${sessionId} for user ${input.userId}`);
            return paymentIntent;
        } catch (error) {
            log.error(`Error creating payment intent: ${error}`);
            throw error;
        }
    }

    /**
     * Find a payment intent by its ID
     */
    async findById(id: string | Types.ObjectId): Promise<IPaymentIntent | null> {
        try {
            return await this.model.findById(id);
        } catch (error) {
            log.error(`Error finding payment intent by ID ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Find a payment intent by session ID
     */
    async findBySessionId(sessionId: string): Promise<IPaymentIntent | null> {
        try {
            return await this.model.findOne({ sessionId });
        } catch (error) {
            log.error(`Error finding payment intent by sessionId ${sessionId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find a payment intent by gateway payment ID
     */
    async findByGatewayPaymentId(gatewayPaymentId: string, gateway: PaymentGateway): Promise<IPaymentIntent | null> {
        try {
            return await this.model.findOne({ gatewayPaymentId, gateway });
        } catch (error) {
            log.error(`Error finding payment intent by gatewayPaymentId ${gatewayPaymentId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find payment intents for a specific user
     */
    async findByUserId(
        userId: string | Types.ObjectId,
        options: {
            status?: PaymentStatus;
            limit?: number;
            skip?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<{ paymentIntents: IPaymentIntent[]; total: number }> {
        try {
            const {
                status,
                limit = 50,
                skip = 0,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = options;

            // Build query
            const query: any = { userId };
            if (status) query.status = status;

            // Find payment intents
            const paymentIntents = await this.model.find(query)
                .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(limit);

            // Count total for pagination
            const total = await this.model.countDocuments(query);

            return { paymentIntents, total };
        } catch (error) {
            log.error(`Error finding payment intents for user ${userId}: ${error}`);
            throw error;
        }
    }

    /**
     * Update a payment intent by its ID
     */
    async update(id: string | Types.ObjectId, update: UpdatePaymentIntentInput): Promise<IPaymentIntent | null> {
        try {
            const paymentIntent = await this.model.findByIdAndUpdate(
                id,
                { $set: update },
                { new: true }
            );

            if (paymentIntent) {
                log.info(`Updated payment intent ${paymentIntent.sessionId}`);
            }

            return paymentIntent;
        } catch (error) {
            log.error(`Error updating payment intent ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Update a payment intent by session ID
     */
    async updateBySessionId(sessionId: string, update: UpdatePaymentIntentInput): Promise<IPaymentIntent | null> {
        try {
            const paymentIntent = await this.model.findOneAndUpdate(
                { sessionId },
                { $set: update },
                { new: true }
            );

            if (paymentIntent) {
                log.info(`Updated payment intent ${sessionId}`);
            }

            return paymentIntent;
        } catch (error) {
            log.error(`Error updating payment intent ${sessionId}: ${error}`);
            throw error;
        }
    }

    /**
     * Add webhook event to payment intent history
     */
    async addWebhookEvent(sessionId: string, status: PaymentStatus, providerData: any): Promise<IPaymentIntent | null> {
        try {
            const paymentIntent = await this.model.findOneAndUpdate(
                { sessionId },
                {
                    $set: { status },
                    $push: {
                        webhookHistory: {
                            timestamp: new Date(),
                            status,
                            providerData
                        }
                    }
                },
                { new: true }
            );

            if (paymentIntent) {
                log.info(`Added webhook event to payment intent ${sessionId}, new status: ${status}`);
            }

            return paymentIntent;
        } catch (error) {
            log.error(`Error adding webhook event to payment intent ${sessionId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find payment intents with specific gateway and status
     * Useful for checking pending payments
     */
    async findByGatewayAndStatus(
        gateway: PaymentGateway,
        status: PaymentStatus,
        limit: number = 100
    ): Promise<IPaymentIntent[]> {
        try {
            return await this.model.find({
                gateway,
                status
            })
                .sort({ createdAt: 1 })
                .limit(limit);
        } catch (error) {
            log.error(`Error finding payment intents by gateway ${gateway} and status ${status}: ${error}`);
            throw error;
        }
    }

    /**
     * Find expired payment intents (older than specified minutes)
     */
    async findExpired(expirationMinutes: number = 60, limit: number = 100): Promise<IPaymentIntent[]> {
        try {
            const expirationDate = new Date(Date.now() - expirationMinutes * 60 * 1000);

            return await this.model.find({
                createdAt: { $lt: expirationDate },
                status: PaymentStatus.PENDING_USER_INPUT
            })
                .sort({ createdAt: 1 })
                .limit(limit);
        } catch (error) {
            log.error(`Error finding expired payment intents: ${error}`);
            throw error;
        }
    }

    /**
     * Finds all payment intents based on filters and pagination options.
     * Used by the admin endpoint.
     */
    async findAllWithFilters(
        filters: FilterQuery<IPaymentIntent>,
        options: PaginationOptions
    ): Promise<{ intents: IPaymentIntent[], totalCount: number }> {
        log.debug('Repository: findAllWithFilters called with filters:', filters);
        log.debug('Repository: findAllWithFilters called with options:', options);

        // Prepare the final query object, potentially transforming filters
        const finalQuery: FilterQuery<IPaymentIntent> = { ...filters };

        // Specific handling for amount if it contains $gte or $lte
        if (filters.amount) {
            finalQuery.amount = { ...filters.amount }; // Keep $gte/$lte
        }

        // Remove page, limit, sortBy, sortOrder from the filter query if they exist
        // Mongoose find doesn't use these as direct query conditions
        delete finalQuery.page;
        delete finalQuery.limit;
        delete finalQuery.sortBy;
        delete finalQuery.sortOrder;

        const { page, limit, sortBy, sortOrder } = options;
        const skip = (page - 1) * limit;

        // Default sort order if not specified
        const sort: { [key: string]: SortOrder } = {};
        if (sortBy) {
            sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        } else {
            sort.createdAt = -1; // Default sort by creation date descending
        }

        try {
            // Build the query using the prepared finalQuery
            const query = this.model.find(finalQuery) // Use finalQuery
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean<IPaymentIntent[]>(); // Explicitly type the lean result as an array of the interface

            // Execute query and count in parallel
            // Cast the result of query.exec() to ensure it matches the lean type
            const [intents, totalCount] = await Promise.all([
                query.exec() as Promise<IPaymentIntent[]>, // Cast the promise result
                this.model.countDocuments(finalQuery) // Use finalQuery for count
            ]);

            log.debug(`Repository: Found ${intents.length} intents, total count ${totalCount}`);
            return { intents, totalCount };

        } catch (error) {
            log.error('Repository Error in findAllWithFilters:', error);
            throw new Error('Database error while fetching payment intents.'); // Generic error for database issues
        }
    }
}

// Export singleton instance
export const paymentIntentRepository = new PaymentIntentRepository();
export default paymentIntentRepository; 