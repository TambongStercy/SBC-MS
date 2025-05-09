import { Types } from 'mongoose';
import PartnerTransactionModel, { IPartnerTransaction, PartnerTransactionType } from '../models/partnerTransaction.model';
import logger from '../../utils/logger';

const log = logger.getLogger('PartnerTransactionRepository');
// Define a generic paginated response structure if not already globally defined
export interface PaginatedResponse<T> {
    docs: T[];
    totalDocs: number;
    limit: number;
    page: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextPage: number | null;
    prevPage: number | null;
}

export class PartnerTransactionRepository {
    async create(data: Partial<IPartnerTransaction>): Promise<IPartnerTransaction> {
        if (!data.partnerId || !data.user || !data.amount || !data.message) {
            throw new Error('Missing required fields for partner transaction.');
        }
        return PartnerTransactionModel.create(data);
    }

    async findByPartnerId(
        partnerId: Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<PaginatedResponse<IPartnerTransaction>> {
        const skip = (page - 1) * limit;
        const totalDocs = await PartnerTransactionModel.countDocuments({ partnerId }).exec();
        const docs = await PartnerTransactionModel.find({ partnerId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

        const totalPages = Math.ceil(totalDocs / limit);

        return {
            docs,
            totalDocs,
            limit,
            page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
        };
    }

    async findByUserId(
        userId: Types.ObjectId, // This is the user who is the partner
        page: number = 1,
        limit: number = 20
    ): Promise<PaginatedResponse<IPartnerTransaction>> {
        const skip = (page - 1) * limit;
        const totalDocs = await PartnerTransactionModel.countDocuments({ user: userId }).exec();
        const docs = await PartnerTransactionModel.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

        const totalPages = Math.ceil(totalDocs / limit);

        return {
            docs,
            totalDocs,
            limit,
            page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            nextPage: page < totalPages ? page + 1 : null,
            prevPage: page > 1 ? page - 1 : null,
        };
    }

    /**
     * Calculates the total sum of withdrawal transactions for a specific partner.
     * @param partnerId The ID of the partner.
     * @returns The total sum of withdrawals, or 0 if none.
     */
    async sumWithdrawalsByPartnerId(partnerId: Types.ObjectId): Promise<number> {
        try {
            const result = await PartnerTransactionModel.aggregate([
                {
                    $match: {
                        partnerId: partnerId,
                        transType: PartnerTransactionType.WITHDRAWAL // Assuming PartnerTransactionType.WITHDRAWAL is 'withdrawal'
                    }
                },
                {
                    $group: {
                        _id: null, // Group all matched documents together
                        totalWithdrawals: { $sum: '$amount' }
                    }
                }
            ]).exec();

            if (result.length > 0 && result[0].totalWithdrawals) {
                return result[0].totalWithdrawals;
            }
            return 0; // No withdrawals found or an issue with aggregation
        } catch (error) {
            log.error(`Error calculating total withdrawals for partner ${partnerId}:`, error);
            throw error; // Re-throw the error to be handled by the service layer
        }
    }
}