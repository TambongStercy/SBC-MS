import { Types } from 'mongoose';
import { IFlashSale, FlashSaleStatus } from '../database/models/flashsale.model';
import { IProduct } from '../database/models/product.model';
import { productRepository } from '../database/repositories/product.repository';
import { flashSaleRepository } from '../database/repositories/flashsale.repository';
import { paymentServiceClient } from './clients/payment.service.client'; // To be created/configured
import { notificationServiceClient } from './clients/notification.service.client'; // Import notification client
import logger from '../utils/logger';
import { AppError } from '../utils/errors'; // Assuming custom error class exists
import config from '../config'; // Import config
import { FilterQuery } from 'mongoose';

const log = logger.getLogger('FlashSaleService');

const FLASH_SALE_FEE = 300; // Seller fee in XAF

class FlashSaleService {

    /**
     * Creates a new flash sale, initiates the seller fee payment.
     */
    async createFlashSale(userId: string, userRole: string, data: {
        productId: string;
        discountedPrice: number;
        startTime: string | Date;
        endTime: string | Date;
    }): Promise<Partial<IFlashSale>> { // Return partial data initially
        log.info(`[FlashSaleService] Attempting to create flash sale for user ${userId} (Role: ${userRole}), product ${data.productId}`);

        const { productId, discountedPrice, startTime, endTime } = data;

        // 1. Validate Input
        if (!Types.ObjectId.isValid(productId)) {
            throw new AppError('Invalid product ID format', 400);
        }
        if (discountedPrice == null || discountedPrice < 0) {
            throw new AppError('Invalid discounted price', 400);
        }
        const parsedStartTime = new Date(startTime);
        const parsedEndTime = new Date(endTime);
        if (isNaN(parsedStartTime.getTime()) || isNaN(parsedEndTime.getTime())) {
            throw new AppError('Invalid start or end time format', 400);
        }
        if (parsedStartTime >= parsedEndTime) {
            throw new AppError('End time must be after start time', 400);
        }
        if (parsedStartTime <= new Date()) {
            // Optionally allow starting immediately, or enforce future start
            throw new AppError('Start time must be in the future', 400);
        }

        // 2. Verify Product and Ownership (conditionally for non-admins)
        const product = await productRepository.findById(productId);
        if (!product) {
            throw new AppError('Product not found', 404);
        }

        // --- Check ownership ONLY if the user is NOT an admin ---
        if (userRole !== 'admin') {
            if (product.userId.toString() !== userId) {
                log.warn(`[Auth Denied] User ${userId} attempted to create flash sale for product ${productId} owned by ${product.userId}`);
                throw new AppError('User does not own this product', 403); // Forbidden
            }
        } else {
            log.info(`[Auth Granted] Admin user ${userId} bypassing ownership check for product ${productId}.`);
        }
        // --- End Ownership Check ---

        if (discountedPrice >= product.price) {
            throw new AppError('Discounted price must be lower than the original price', 400);
        }

        let newFlashSale: IFlashSale;
        let returnData: Partial<IFlashSale>;

        if (userRole === 'admin') {
            // --- Admin Flow: Skip Payment, Create directly as Scheduled/Active ---
            log.info(`[Admin Flow] Bypassing payment for flash sale creation by admin ${userId}`);

            const initialStatus = (parsedStartTime <= new Date()) ? FlashSaleStatus.ACTIVE : FlashSaleStatus.SCHEDULED;
            log.info(`[Admin Flow] Setting initial status to: ${initialStatus}`);

            const flashSaleData: Partial<IFlashSale> = {
                productId: new Types.ObjectId(productId),
                sellerUserId: new Types.ObjectId(userId), // Still record the original seller
                originalPrice: product.price,
                discountedPrice: discountedPrice,
                startTime: parsedStartTime,
                endTime: parsedEndTime,
                status: initialStatus,
                // No feePaymentIntentId needed
                feePaymentStatus: 'succeeded' // Mark fee as 'succeeded' since admin bypassed it
            };
            newFlashSale = await flashSaleRepository.create(flashSaleData);
            log.info(`[Admin Flow] Flash sale record created directly with status ${initialStatus}: ${newFlashSale._id}`);

            // Prepare return data for admin (consistent partial shape for now)
            returnData = {
                _id: newFlashSale._id,
                status: newFlashSale.status
            };

        } else {
            // --- Non-Admin Flow: Initiate Payment, Create as Pending Payment ---
            log.info(`[User Flow] Initiating payment for flash sale creation by user ${userId}`);
            // 3. Initiate Fee Payment with Payment Service
            let paymentIntentId: string | undefined;
            try {
                log.info(`Initiating payment intent for flash sale fee (${FLASH_SALE_FEE} XAF)`);
                const paymentIntent = await paymentServiceClient.createIntent({
                    userId: userId, // Seller's ID
                    paymentType: 'FLASH_SALE_FEE',
                    amount: FLASH_SALE_FEE,
                    currency: 'XAF',
                    metadata: {
                        productId: productId,
                        sellerUserId: userId,
                        originatingService: 'product-service',
                        callbackPath: `${config.selfBaseUrl}/api/flash-sales/internal/update-payment-status`
                    }
                });
                paymentIntentId = paymentIntent?.data?.sessionId;
                if (!paymentIntentId) {
                    throw new Error('Failed to get paymentIntentId from payment service');
                }
                log.info(`Payment intent created: ${paymentIntentId}`);
            } catch (paymentError: any) {
                log.error('Failed to create payment intent for flash sale fee:', paymentError);
                throw new AppError('Could not initiate payment for flash sale fee', 500);
            }

            // 4. Create FlashSale record in DB using FlashSaleRepository
            const flashSaleData: Partial<IFlashSale> = {
                productId: new Types.ObjectId(productId),
                sellerUserId: new Types.ObjectId(userId),
                originalPrice: product.price,
                discountedPrice: discountedPrice,
                startTime: parsedStartTime,
                endTime: parsedEndTime,
                status: FlashSaleStatus.PENDING_PAYMENT,
                feePaymentIntentId: paymentIntentId,
                feePaymentStatus: 'pending'
            };
            newFlashSale = await flashSaleRepository.create(flashSaleData);
            log.info(`Flash sale record created (pending payment): ${newFlashSale._id}`);

            // Prepare return data for non-admin
            returnData = {
                _id: newFlashSale._id,
                status: newFlashSale.status,
                feePaymentIntentId: newFlashSale.feePaymentIntentId
            };
        }

        // 5. Return relevant data (consistent shape defined above)
        return returnData;
    }

    /**
     * Handles payment status updates from the payment service.
     */
    async handlePaymentUpdate(paymentIntentId: string, paymentStatus: 'succeeded' | 'failed'): Promise<void> {
        log.info(`Handling payment update for intent ${paymentIntentId}, status: ${paymentStatus}`);

        const flashSale = await flashSaleRepository.findOne({ feePaymentIntentId: paymentIntentId }, 'productId feePaymentStatus sellerUserId startTime', { path: 'productId', select: 'name' });

        if (!flashSale) {
            log.warn(`Flash sale not found for payment intent ID: ${paymentIntentId}. Ignoring update.`);
            throw new AppError('Flash sale not found for payment intent', 404);
        }

        console.log('Flash sale:', flashSale);

        if (flashSale.feePaymentStatus !== 'pending') {
            log.warn(`Payment status update for intent ${paymentIntentId} ignored. Flash sale fee status is already '${flashSale.feePaymentStatus}'.`);
            return;
        }

        let update: Partial<IFlashSale> = {
            feePaymentStatus: paymentStatus
        };
        let newStatus: FlashSaleStatus | undefined;


        if (paymentStatus === 'succeeded') {
            newStatus = (flashSale.startTime <= new Date()) ? FlashSaleStatus.ACTIVE : FlashSaleStatus.SCHEDULED;
            update.status = newStatus;
            log.info(`Fee payment succeeded for FlashSale ${flashSale._id}. Status updated to ${update.status}.`);

            // --- Send Notification to Seller --- 
            try {
                const product = flashSale.productId as unknown as Pick<IProduct, 'name'>; // Type assertion after populate
                const productName = product?.name || 'product';
                const message = `Your flash sale for "${productName}" is now ${newStatus === FlashSaleStatus.ACTIVE ? 'active' : 'scheduled'} starting at ${flashSale.startTime.toLocaleString()}.`;

                // Send notification (e.g., IN_APP channel)
                // We need recipient info - assume sellerUserId is correct.
                // For IN_APP, recipient might just be the userId.
                await notificationServiceClient.sendNotification({
                    userId: flashSale.sellerUserId.toString(),
                    type: 'FLASH_SALE_CONFIRMED', // Specific type
                    channel: 'IN_APP', // Or EMAIL, PUSH etc.
                    recipient: flashSale.sellerUserId.toString(), // Recipient for IN_APP is the user themselves
                    data: {
                        body: message,
                        relatedData: {
                            flashSaleId: flashSale._id.toString(),
                            productId: flashSale.productId.toString()
                        }
                    }
                });
                log.info(`Sent ${newStatus} flash sale notification to seller ${flashSale.sellerUserId}`);
            } catch (notificationError) {
                log.error(`Failed to send notification to seller for flash sale ${flashSale._id}:`, notificationError);
                // Don't block the flow if notification fails
            }
            // --- End Notification --- 

        } else { // paymentStatus === 'failed'
            update.status = FlashSaleStatus.PAYMENT_FAILED;
            log.info(`Fee payment failed for FlashSale ${flashSale._id}. Status updated to ${update.status}.`);
            // Optionally notify seller about payment failure?
        }

        await flashSaleRepository.findByIdAndUpdate(flashSale._id, update);
    }

    /**
     * Finds a flash sale by ID.
     */
    async getFlashSaleById(flashSaleId: string): Promise<IFlashSale | null> {
        log.info(`Service: Fetching flash sale by ID ${flashSaleId}`);
        if (!Types.ObjectId.isValid(flashSaleId)) {
            throw new AppError('Invalid flash sale ID format', 400);
        }
        const sale = await flashSaleRepository.findById(flashSaleId);
        if (!sale) {
            throw new AppError('Flash sale not found', 404);
        }
        // Ensure analytics fields are returned (should be included by .lean() if in model)
        return sale;
    }

    // Update placeholder methods to potentially use repositories
    async getActiveFlashSales(options: { page: number, limit: number }): Promise<any> {
        log.info('Service: Fetching active flash sales');
        const { page, limit } = options;
        const skip = (page - 1) * limit; // Calculate skip

        const findQuery = {
            status: FlashSaleStatus.ACTIVE,
            startTime: { $lte: new Date() },
            endTime: { $gte: new Date() }
        };
        // Pass skip and limit to repository find method
        const activeSales = await flashSaleRepository.find(findQuery, limit, skip, { startTime: 1 });
        const totalCount = await flashSaleRepository.count(findQuery);
        return {
            sales: activeSales,
            totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit)
        };
    }

    async getMyFlashSales(userId: string, options: { page: number, limit: number }): Promise<any> {
        log.info(`Service: Fetching flash sales for user ${userId}`);
        const { page, limit } = options;
        const skip = (page - 1) * limit; // Calculate skip

        const findQuery = { sellerUserId: new Types.ObjectId(userId) };
        // Pass skip and limit to repository find method
        const mySales = await flashSaleRepository.find(findQuery, limit, skip, { createdAt: -1 });
        const totalCount = await flashSaleRepository.count(findQuery);
        return {
            sales: mySales,
            totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit)
        };
    }

    async updateFlashSale(userId: string, flashSaleId: string, updateData: Partial<Pick<IFlashSale, 'discountedPrice' | 'startTime' | 'endTime'>>): Promise<IFlashSale | null> {
        log.info(`Service: Updating flash sale ${flashSaleId} for user ${userId}`);
        const flashSale = await flashSaleRepository.findById(flashSaleId);

        if (!flashSale) {
            throw new AppError('Flash sale not found', 404);
        }
        if (flashSale.sellerUserId.toString() !== userId) {
            throw new AppError('User not authorized to update this flash sale', 403);
        }
        // Allow updates only if pending payment or scheduled
        if (flashSale.status !== FlashSaleStatus.PENDING_PAYMENT && flashSale.status !== FlashSaleStatus.SCHEDULED) {
            throw new AppError(`Cannot update flash sale in status: ${flashSale.status}`, 400);
        }

        // --- Start Validation --- 
        const validatedUpdate: Partial<IFlashSale> = {};
        let hasUpdates = false;

        // 1. Validate Discounted Price
        if (updateData.discountedPrice !== undefined) {
            if (updateData.discountedPrice < 0) {
                throw new AppError('Discounted price cannot be negative', 400);
            }
            if (updateData.discountedPrice >= flashSale.originalPrice) {
                throw new AppError('Discounted price must be lower than the original price', 400);
            }
            validatedUpdate.discountedPrice = updateData.discountedPrice;
            hasUpdates = true;
        }

        // 2. Validate Start and End Times
        const newStartTime = updateData.startTime ? new Date(updateData.startTime) : null;
        const newEndTime = updateData.endTime ? new Date(updateData.endTime) : null;

        if (newStartTime && isNaN(newStartTime.getTime())) {
            throw new AppError('Invalid start time format', 400);
        }
        if (newEndTime && isNaN(newEndTime.getTime())) {
            throw new AppError('Invalid end time format', 400);
        }

        // Use existing times if not provided in updateData
        const finalStartTime = newStartTime || flashSale.startTime;
        const finalEndTime = newEndTime || flashSale.endTime;

        // Check if start time is in the past (allow if already scheduled/pending)
        if (newStartTime && newStartTime <= new Date()) {
            // Depending on policy, you might allow updating to start immediately or enforce future start
            // For now, let's prevent setting a start time in the past unless it's already active (which is blocked above)
            throw new AppError('Start time cannot be set to the past', 400);
        }

        // Check if end time is before start time
        if (finalStartTime >= finalEndTime) {
            throw new AppError('End time must be after start time', 400);
        }

        // If times were changed, add them to the update
        if (newStartTime) {
            validatedUpdate.startTime = newStartTime;
            hasUpdates = true;
        }
        if (newEndTime) {
            validatedUpdate.endTime = newEndTime;
            hasUpdates = true;
        }
        // --- End Validation ---

        if (!hasUpdates) {
            log.warn(`No valid fields to update for flash sale ${flashSaleId}. Returning current data.`);
            return flashSale; // Return existing data if no valid updates provided
        }

        log.info(`Applying validated updates to flash sale ${flashSaleId}`, { validatedUpdate });
        return flashSaleRepository.findByIdAndUpdate(flashSaleId, validatedUpdate);
    }

    async cancelFlashSale(userId: string, flashSaleId: string): Promise<boolean> {
        log.info(`Service: Cancelling flash sale ${flashSaleId} for user ${userId}`);
        const flashSale = await flashSaleRepository.findById(flashSaleId);
        if (!flashSale || flashSale.sellerUserId.toString() !== userId) {
            throw new AppError('Flash sale not found or user not authorized', 404);
        }
        if (flashSale.status !== FlashSaleStatus.PENDING_PAYMENT && flashSale.status !== FlashSaleStatus.SCHEDULED) {
            throw new AppError('Cannot cancel flash sale in its current status', 400);
        }
        const updated = await flashSaleRepository.findByIdAndUpdate(flashSaleId, { status: FlashSaleStatus.CANCELLED });
        return !!updated;
    }

    /**
     * Tracks a view for a specific flash sale.
     */
    async trackView(flashSaleId: string | Types.ObjectId): Promise<void> {
        log.debug(`Tracking view for flash sale ${flashSaleId}`);
        // No need to check existence first, findByIdAndUpdate handles non-existent ID gracefully.
        // Let the repository handle the increment.
        await flashSaleRepository.incrementViewCount(flashSaleId);
        // No return needed, fire and forget
    }

    /**
     * Tracks a WhatsApp click for a specific flash sale.
     */
    async trackWhatsappClick(flashSaleId: string | Types.ObjectId): Promise<void> {
        log.debug(`Tracking WhatsApp click for flash sale ${flashSaleId}`);
        // No need to check existence first.
        await flashSaleRepository.incrementWhatsappClickCount(flashSaleId);
        // No return needed, fire and forget
    }

    // --- Admin Service Methods ---

    /**
     * [Admin] List all flash sales with filtering and pagination.
     */
    async adminListFlashSales(filters: FilterQuery<IFlashSale>, options: { page: number, limit: number, sort?: any }): Promise<any> {
        log.info('[Admin Service] Listing flash sales with filters:', filters);
        const { page, limit, sort = { createdAt: -1 } } = options;
        const skip = (page - 1) * limit;

        // Construct query (allow filtering by status, productId, sellerUserId, date ranges etc.)
        const findQuery: FilterQuery<IFlashSale> = { ...filters };

        // Convert relevant filter string IDs to ObjectIds if present
        if (findQuery.productId && typeof findQuery.productId === 'string') {
            findQuery.productId = new Types.ObjectId(findQuery.productId);
        }
        if (findQuery.sellerUserId && typeof findQuery.sellerUserId === 'string') {
            findQuery.sellerUserId = new Types.ObjectId(findQuery.sellerUserId);
        }
        // Add date range filtering if needed (e.g., createdAt range)

        const sales = await flashSaleRepository.find(findQuery, limit, skip, sort);
        const totalCount = await flashSaleRepository.count(findQuery);

        return {
            sales,
            totalCount,
            page,
            totalPages: Math.ceil(totalCount / limit),
            limit
        };
    }

    /**
     * [Admin] Get full details of a specific flash sale.
     * Reuses getFlashSaleById as it doesn't have user restrictions.
     */
    async adminGetFlashSaleById(flashSaleId: string): Promise<IFlashSale | null> {
        log.info(`[Admin Service] Getting flash sale details for ID ${flashSaleId}`);
        // Can reuse the public getFlashSaleById as it has no user restriction
        return this.getFlashSaleById(flashSaleId);
    }

    /**
     * [Admin] Update any flash sale.
     */
    async adminUpdateFlashSale(flashSaleId: string, updateData: Partial<Pick<IFlashSale, 'discountedPrice' | 'startTime' | 'endTime' | 'status' | 'feePaymentStatus'>>): Promise<IFlashSale | null> {
        log.info(`[Admin Service] Updating flash sale ${flashSaleId}`);
        if (!Types.ObjectId.isValid(flashSaleId)) {
            throw new AppError('Invalid flash sale ID format', 400);
        }

        // TODO: Add more robust validation for updateData fields and status transitions if needed
        const validatedUpdate: Partial<IFlashSale> = {};
        if (updateData.discountedPrice !== undefined) validatedUpdate.discountedPrice = updateData.discountedPrice;
        if (updateData.startTime) validatedUpdate.startTime = new Date(updateData.startTime);
        if (updateData.endTime) validatedUpdate.endTime = new Date(updateData.endTime);
        if (updateData.status) validatedUpdate.status = updateData.status;
        if (updateData.feePaymentStatus) validatedUpdate.feePaymentStatus = updateData.feePaymentStatus;

        if (Object.keys(validatedUpdate).length === 0) {
            throw new AppError('No valid fields provided for update', 400);
        }

        // Add further validation (e.g., price checks, date logic) as needed
        if (validatedUpdate.startTime && validatedUpdate.endTime && validatedUpdate.startTime >= validatedUpdate.endTime) {
            throw new AppError('End time must be after start time', 400);
        }

        const updatedSale = await flashSaleRepository.findByIdAndUpdate(flashSaleId, validatedUpdate);
        if (!updatedSale) {
            throw new AppError('Flash sale not found', 404);
        }
        return updatedSale;
    }

    /**
     * [Admin] Delete (or cancel) any flash sale.
     * Currently implements cancellation by setting status.
     */
    async adminDeleteFlashSale(flashSaleId: string): Promise<boolean> {
        log.info(`[Admin Service] Cancelling flash sale ${flashSaleId}`);
        if (!Types.ObjectId.isValid(flashSaleId)) {
            throw new AppError('Invalid flash sale ID format', 400);
        }
        // Find first to ensure it exists
        const flashSale = await flashSaleRepository.findById(flashSaleId);
        if (!flashSale) {
            throw new AppError('Flash sale not found', 404);
        }
        // Update status to Cancelled
        const updated = await flashSaleRepository.findByIdAndUpdate(flashSaleId, { status: FlashSaleStatus.CANCELLED });
        return !!updated;
    }

    /**
     * [Admin] Update the status of a specific flash sale.
     */
    async adminUpdateFlashSaleStatus(flashSaleId: string, newStatus: FlashSaleStatus): Promise<IFlashSale | null> {
        log.info(`[Admin Service] Updating status of flash sale ${flashSaleId} to ${newStatus}`);
        if (!Types.ObjectId.isValid(flashSaleId)) {
            throw new AppError('Invalid flash sale ID format', 400);
        }
        // Validate if the newStatus is a valid enum value
        if (!Object.values(FlashSaleStatus).includes(newStatus)) {
            throw new AppError(`Invalid status value: ${newStatus}`, 400);
        }
        // TODO: Consider adding logic for allowed status transitions

        const updatedSale = await flashSaleRepository.findByIdAndUpdate(flashSaleId, { status: newStatus });
        if (!updatedSale) {
            throw new AppError('Flash sale not found', 404);
        }
        return updatedSale;
    }
}

export const flashSaleService = new FlashSaleService(); 