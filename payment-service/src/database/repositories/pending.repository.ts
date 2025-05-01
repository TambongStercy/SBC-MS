import { Types } from 'mongoose';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import PendingModel, { IPending, PendingStatus, VerificationType } from '../models/pending.model';
import { TransactionType, Currency } from '../models/transaction.model';
import logger from '../../utils/logger';

const log = logger.getLogger('PendingRepository');

// Interface for creating a new pending transaction
export interface CreatePendingInput {
    userId: string | Types.ObjectId;
    transactionType: TransactionType;
    amount: number;
    currency: Currency;
    verificationType: VerificationType;
    description: string;
    metadata?: Record<string, any>;
    callbackUrl?: string;
    ipAddress?: string;
    deviceInfo?: string;
    expiresIn?: number; // In minutes, default is 30
}

// Interface for updating a pending transaction
export interface UpdatePendingInput {
    status?: PendingStatus;
    metadata?: Record<string, any>;
}

// Pending repository for handling database operations
class PendingRepository {
    /**
     * Create a new pending transaction
     */
    async create(input: CreatePendingInput): Promise<IPending> {
        try {
            const pendingId = nanoid(16);
            const expiresIn = input.expiresIn || 30; // Default expiration is 30 minutes
            const expiresAt = new Date(Date.now() + expiresIn * 60 * 1000);

            // Generate verification code if needed
            let verificationCode: string | undefined;
            let verificationExpiry: Date | undefined;

            if (input.verificationType !== VerificationType.NONE) {
                verificationCode = this.generateVerificationCode();
                verificationExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry for verification
            }

            const pending = await PendingModel.create({
                pendingId,
                userId: input.userId,
                transactionType: input.transactionType,
                amount: input.amount,
                currency: input.currency,
                status: PendingStatus.AWAITING_VERIFICATION,
                verificationType: input.verificationType,
                verificationCode,
                verificationExpiry,
                description: input.description,
                metadata: input.metadata,
                callbackUrl: input.callbackUrl,
                ipAddress: input.ipAddress,
                deviceInfo: input.deviceInfo,
                expiresAt,
            });

            log.info(`Created pending transaction ${pendingId} for user ${input.userId}`);
            return pending;
        } catch (error) {
            log.error(`Error creating pending transaction: ${error}`);
            throw error;
        }
    }

    /**
     * Find a pending transaction by its ID
     */
    async findById(id: string | Types.ObjectId): Promise<IPending | null> {
        try {
            return await PendingModel.findById(id);
        } catch (error) {
            log.error(`Error finding pending transaction by ID ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Find a pending transaction by its pending ID
     */
    async findByPendingId(pendingId: string): Promise<IPending | null> {
        try {
            return await PendingModel.findOne({ pendingId });
        } catch (error) {
            log.error(`Error finding pending transaction by pendingId ${pendingId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find pending transactions for a specific user
     */
    async findByUserId(
        userId: string | Types.ObjectId,
        options: {
            status?: PendingStatus;
            limit?: number;
            skip?: number;
        } = {}
    ): Promise<{ pendings: IPending[]; total: number }> {
        try {
            const { status, limit = 50, skip = 0 } = options;

            // Build query
            const query: any = { userId };
            if (status) query.status = status;

            // Find pending transactions
            const pendings = await PendingModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            // Count total for pagination
            const total = await PendingModel.countDocuments(query);

            return { pendings, total };
        } catch (error) {
            log.error(`Error finding pending transactions for user ${userId}: ${error}`);
            throw error;
        }
    }

    /**
     * Find expired pending transactions
     */
    async findExpired(limit: number = 100): Promise<IPending[]> {
        try {
            const now = new Date();

            return await PendingModel.find({
                expiresAt: { $lt: now },
                status: { $nin: [PendingStatus.EXPIRED, PendingStatus.PROCESSING] }
            })
                .sort({ expiresAt: 1 })
                .limit(limit);
        } catch (error) {
            log.error(`Error finding expired pending transactions: ${error}`);
            throw error;
        }
    }

    /**
     * Update a pending transaction by its ID
     */
    async update(id: string | Types.ObjectId, update: UpdatePendingInput): Promise<IPending | null> {
        try {
            const pending = await PendingModel.findByIdAndUpdate(
                id,
                { $set: update },
                { new: true }
            );

            if (pending) {
                log.info(`Updated pending transaction ${pending.pendingId}`);
            }

            return pending;
        } catch (error) {
            log.error(`Error updating pending transaction ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Update a pending transaction's status
     */
    async updateStatus(pendingId: string, status: PendingStatus): Promise<IPending | null> {
        try {
            const pending = await PendingModel.findOneAndUpdate(
                { pendingId },
                { $set: { status } },
                { new: true }
            );

            if (pending) {
                log.info(`Updated pending transaction ${pendingId} status to ${status}`);
            }

            return pending;
        } catch (error) {
            log.error(`Error updating pending transaction ${pendingId} status: ${error}`);
            throw error;
        }
    }

    /**
     * Verify a pending transaction with verification code
     */
    async verify(pendingId: string, verificationCode: string): Promise<{ verified: boolean; pending: IPending | null }> {
        try {
            // Get the pending transaction with verification code (which is normally hidden)
            const pending = await PendingModel.findOne({ pendingId }).select('+verificationCode');

            if (!pending) {
                return { verified: false, pending: null };
            }

            // Check if already verified or expired
            if (
                pending.status !== PendingStatus.AWAITING_VERIFICATION ||
                !pending.verificationCode ||
                !pending.verificationExpiry
            ) {
                return { verified: false, pending };
            }

            // Check if verification has expired
            if (pending.verificationExpiry < new Date()) {
                await this.updateStatus(pendingId, PendingStatus.EXPIRED);
                return { verified: false, pending: null };
            }

            // Verify the code
            const isMatch = pending.verificationCode === verificationCode;

            if (isMatch) {
                // Update to processing if verified
                const updatedPending = await this.updateStatus(pendingId, PendingStatus.PROCESSING);
                log.info(`Verified pending transaction ${pendingId}`);
                return { verified: true, pending: updatedPending };
            }

            return { verified: false, pending };
        } catch (error) {
            log.error(`Error verifying pending transaction ${pendingId}: ${error}`);
            throw error;
        }
    }

    /**
     * Delete a pending transaction (only for expired ones)
     */
    async delete(id: string | Types.ObjectId): Promise<boolean> {
        try {
            const result = await PendingModel.deleteOne({ _id: id, status: PendingStatus.EXPIRED });

            const deleted = result.deletedCount === 1;
            if (deleted) {
                log.info(`Deleted expired pending transaction ${id}`);
            }

            return deleted;
        } catch (error) {
            log.error(`Error deleting pending transaction ${id}: ${error}`);
            throw error;
        }
    }

    /**
     * Generate a verification code
     */
    private generateVerificationCode(): string {
        // Generate a 6-digit code
        return crypto.randomInt(100000, 999999).toString();
    }
}

// Export singleton instance
export const pendingRepository = new PendingRepository();
export default pendingRepository; 