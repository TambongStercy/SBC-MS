import { BaseRepository } from './base.repository';
import RecoverUserTransactionModel, { 
    IRecoverUserTransaction, 
    RecoveryStatus, 
    RecoveryProvider, 
    RecoveryTransactionType 
} from '../models/recover-user-transaction.model';
import { Types } from 'mongoose';
import logger from '../../utils/logger';
import { generatePhoneMatchQuery } from '../../utils/phone-normalizer';

const log = logger.getLogger('RecoverUserTransactionRepository');

export class RecoverUserTransactionRepository extends BaseRepository<IRecoverUserTransaction> {
    constructor() {
        super(RecoverUserTransactionModel);
    }

    /**
     * Create a recover user transaction record
     */
    async create(data: Partial<IRecoverUserTransaction>): Promise<IRecoverUserTransaction> {
        try {
            log.info(`Creating recover user transaction for provider ${data.provider}, reference: ${data.transactionReference}`);
            const record = new RecoverUserTransactionModel(data);
            return await record.save();
        } catch (error: any) {
            if (error.code === 11000) { // Duplicate key error
                log.warn(`Recover transaction already exists for provider ${data.provider}, reference: ${data.transactionReference}`);
                throw new Error(`Recovery record already exists for ${data.provider} transaction ${data.transactionReference}`);
            }
            throw error;
        }
    }

    /**
     * Find records by email that are not restored
     */
    async findByEmailNotRestored(email: string): Promise<IRecoverUserTransaction[]> {
        return await RecoverUserTransactionModel.find({
            userEmail: email,
            recoveryStatus: RecoveryStatus.NOT_RESTORED
        }).sort({ createdAt: -1 });
    }

    /**
     * Find records by phone number that are not restored
     * Now supports multiple phone number formats and nested fields
     */
    async findByPhoneNotRestored(phoneNumber: string): Promise<IRecoverUserTransaction[]> {
        const phoneConditions = generatePhoneMatchQuery(phoneNumber);
        
        return await RecoverUserTransactionModel.find({
            $or: phoneConditions,
            recoveryStatus: RecoveryStatus.NOT_RESTORED
        }).sort({ createdAt: -1 });
    }

    /**
     * Find records by email, phone, or userId that are not restored
     * Now supports multiple phone number formats and nested fields
     */
    async findByEmailOrPhoneNotRestored(email?: string, phoneNumber?: string, userId?: string): Promise<IRecoverUserTransaction[]> {
        const query: any = {
            recoveryStatus: RecoveryStatus.NOT_RESTORED
        };

        if (email || phoneNumber || userId) {
            query.$or = [];
            
            if (email) {
                query.$or.push({ userEmail: email });
            }
            
            if (phoneNumber) {
                const phoneConditions = generatePhoneMatchQuery(phoneNumber);
                query.$or.push(...phoneConditions);
            }
            
            if (userId) {
                query.$or.push({ userIdFromProvider: userId });
            }
        }

        return await RecoverUserTransactionModel.find(query).sort({ createdAt: -1 });
    }

    /**
     * Check if transaction already exists in recovery
     */
    async existsByProviderAndReference(provider: RecoveryProvider, transactionReference: string): Promise<boolean> {
        const count = await RecoverUserTransactionModel.countDocuments({
            provider,
            transactionReference
        });
        return count > 0;
    }

    /**
     * Mark record as restored
     */
    async markAsRestored(id: Types.ObjectId, restoredUserId: Types.ObjectId, restoredTransactionId: string): Promise<IRecoverUserTransaction | null> {
        return await RecoverUserTransactionModel.findByIdAndUpdate(
            id,
            {
                recoveryStatus: RecoveryStatus.RESTORED,
                restoredUserId,
                restoredTransactionId,
                restoredAt: new Date()
            },
            { new: true }
        );
    }

    /**
     * Mark multiple records as restored for a user
     * Now supports multiple phone number formats and nested fields
     */
    async markMultipleAsRestored(userEmail?: string, userPhoneNumber?: string, restoredUserId?: Types.ObjectId): Promise<number> {
        const query: any = {
            recoveryStatus: RecoveryStatus.NOT_RESTORED
        };

        if (userEmail || userPhoneNumber) {
            query.$or = [];
            
            if (userEmail) {
                query.$or.push({ userEmail });
            }
            
            if (userPhoneNumber) {
                const phoneConditions = generatePhoneMatchQuery(userPhoneNumber);
                query.$or.push(...phoneConditions);
            }
        }

        const result = await RecoverUserTransactionModel.updateMany(
            query,
            {
                recoveryStatus: RecoveryStatus.RESTORED,
                restoredUserId,
                restoredAt: new Date()
            }
        );

        return result.modifiedCount;
    }

    /**
     * Get recovery statistics
     */
    async getRecoveryStats(): Promise<{
        total: number;
        notRestored: number;
        restored: number;
        byProvider: Record<string, number>;
        byTransactionType: Record<string, number>;
    }> {
        const [total, notRestored, restored, byProvider, byTransactionType] = await Promise.all([
            RecoverUserTransactionModel.countDocuments(),
            RecoverUserTransactionModel.countDocuments({ recoveryStatus: RecoveryStatus.NOT_RESTORED }),
            RecoverUserTransactionModel.countDocuments({ recoveryStatus: RecoveryStatus.RESTORED }),
            RecoverUserTransactionModel.aggregate([
                { $group: { _id: '$provider', count: { $sum: 1 } } }
            ]),
            RecoverUserTransactionModel.aggregate([
                { $group: { _id: '$transactionType', count: { $sum: 1 } } }
            ])
        ]);

        const providerStats: Record<string, number> = {};
        byProvider.forEach(item => {
            providerStats[item._id] = item.count;
        });

        const typeStats: Record<string, number> = {};
        byTransactionType.forEach(item => {
            typeStats[item._id] = item.count;
        });

        return {
            total,
            notRestored,
            restored,
            byProvider: providerStats,
            byTransactionType: typeStats
        };
    }

    /**
     * Find recently restored records by email or phone within specified hours
     * Now supports multiple phone number formats and nested fields
     */
    async findRecentlyRestored(email?: string, phoneNumber?: string, hoursBack: number = 24): Promise<IRecoverUserTransaction[]> {
        const query: any = {
            recoveryStatus: RecoveryStatus.RESTORED,
            restoredAt: {
                $gte: new Date(Date.now() - hoursBack * 60 * 60 * 1000)
            }
        };

        if (email || phoneNumber) {
            query.$or = [];
            
            if (email) {
                query.$or.push({ userEmail: email });
            }
            
            if (phoneNumber) {
                const phoneConditions = generatePhoneMatchQuery(phoneNumber);
                query.$or.push(...phoneConditions);
            }
        }

        return await RecoverUserTransactionModel.find(query).sort({ restoredAt: -1 });
    }

    /**
     * Find records by provider and transaction type with pagination
     */
    async findWithFilters(
        filters: {
            provider?: RecoveryProvider;
            transactionType?: RecoveryTransactionType;
            recoveryStatus?: RecoveryStatus;
            userEmail?: string;
            userPhoneNumber?: string;
        },
        options: {
            page: number;
            limit: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        }
    ): Promise<{ records: IRecoverUserTransaction[]; total: number; page: number; totalPages: number }> {
        const query: any = {};

        if (filters.provider) query.provider = filters.provider;
        if (filters.transactionType) query.transactionType = filters.transactionType;
        if (filters.recoveryStatus) query.recoveryStatus = filters.recoveryStatus;
        if (filters.userEmail) query.userEmail = new RegExp(filters.userEmail, 'i');
        if (filters.userPhoneNumber) {
            const phoneConditions = generatePhoneMatchQuery(filters.userPhoneNumber);
            query.$or = (query.$or || []).concat(phoneConditions);
        }

        const sortBy = options.sortBy || 'createdAt';
        const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
        const skip = (options.page - 1) * options.limit;

        const [records, total] = await Promise.all([
            RecoverUserTransactionModel
                .find(query)
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(options.limit),
            RecoverUserTransactionModel.countDocuments(query)
        ]);

        return {
            records,
            total,
            page: options.page,
            totalPages: Math.ceil(total / options.limit)
        };
    }
}

export const recoverUserTransactionRepository = new RecoverUserTransactionRepository();