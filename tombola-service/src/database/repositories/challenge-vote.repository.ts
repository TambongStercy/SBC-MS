import ChallengeVoteModel, { IChallengeVote, VotePaymentStatus, VoteType } from '../models/challenge-vote.model';
import { Types, FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import logger from '../../utils/logger';

const log = logger.getLogger('ChallengeVoteRepository');

export class ChallengeVoteRepository {

    /**
     * Creates a new ChallengeVote record.
     */
    async create(data: Partial<IChallengeVote>): Promise<IChallengeVote> {
        try {
            const newVote = await ChallengeVoteModel.create(data);
            log.info(`Created new ChallengeVote: ${newVote._id} for entrepreneur ${newVote.entrepreneurId}`);
            return newVote;
        } catch (error: any) {
            log.error(`Error creating ChallengeVote: ${error.message}`, { data });
            throw error;
        }
    }

    /**
     * Finds a single ChallengeVote matching the query.
     */
    async findOne(query: FilterQuery<IChallengeVote>): Promise<IChallengeVote | null> {
        try {
            return await ChallengeVoteModel.findOne(query).lean() as IChallengeVote | null;
        } catch (error: any) {
            log.error(`Error finding ChallengeVote: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Finds a ChallengeVote by its ID.
     */
    async findById(id: string | Types.ObjectId): Promise<IChallengeVote | null> {
        try {
            return await ChallengeVoteModel.findById(id).lean() as IChallengeVote | null;
        } catch (error: any) {
            log.error(`Error finding ChallengeVote by ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Finds multiple ChallengeVotes matching a query with pagination and sorting.
     */
    async find(
        query: FilterQuery<IChallengeVote>,
        limit: number = 10,
        skip: number = 0,
        sort: string | { [key: string]: SortOrder | { $meta: any; } } | [string, SortOrder][] | null | undefined = { createdAt: -1 }
    ): Promise<IChallengeVote[]> {
        try {
            return await ChallengeVoteModel.find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean() as unknown as IChallengeVote[];
        } catch (error: any) {
            log.error(`Error finding ChallengeVotes: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Counts documents matching a query.
     */
    async count(query: FilterQuery<IChallengeVote>): Promise<number> {
        try {
            return await ChallengeVoteModel.countDocuments(query);
        } catch (error: any) {
            log.error(`Error counting ChallengeVotes: ${error.message}`, { query });
            throw error;
        }
    }

    /**
     * Updates a ChallengeVote by its ID.
     */
    async findByIdAndUpdate(id: string | Types.ObjectId, update: UpdateQuery<IChallengeVote>): Promise<IChallengeVote | null> {
        try {
            const updateData = update.$set || update.$inc || update.$push ? update : { $set: update };
            const updatedVote = await ChallengeVoteModel.findByIdAndUpdate(id, updateData, { new: true }).lean() as IChallengeVote | null;
            if (updatedVote) {
                log.info(`Updated ChallengeVote ${id}`);
            }
            return updatedVote;
        } catch (error: any) {
            log.error(`Error updating ChallengeVote ${id}: ${error.message}`, { update });
            throw error;
        }
    }

    /**
     * Updates the payment status of a ChallengeVote.
     */
    async updateStatus(id: string | Types.ObjectId, status: VotePaymentStatus): Promise<IChallengeVote | null> {
        try {
            return await this.findByIdAndUpdate(id, { paymentStatus: status });
        } catch (error: any) {
            log.error(`Error updating ChallengeVote status for ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Deletes a ChallengeVote by its ID.
     */
    async deleteById(id: string | Types.ObjectId): Promise<IChallengeVote | null> {
        try {
            log.info(`Repository: Attempting to delete ChallengeVote with ID: ${id}`);
            const result = await ChallengeVoteModel.findByIdAndDelete(id).exec();
            if (result) {
                log.info(`Repository: Successfully deleted ChallengeVote with ID: ${id}`);
            } else {
                log.warn(`Repository: ChallengeVote with ID: ${id} not found for deletion.`);
            }
            return result;
        } catch (error: any) {
            log.error(`Repository: Error deleting ChallengeVote with ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Counts total votes (by voteQuantity) for an entrepreneur.
     */
    async sumVoteQuantityByEntrepreneur(entrepreneurId: string | Types.ObjectId): Promise<number> {
        try {
            const result = await ChallengeVoteModel.aggregate([
                {
                    $match: {
                        entrepreneurId: new Types.ObjectId(entrepreneurId.toString()),
                        paymentStatus: VotePaymentStatus.COMPLETED
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalVotes: { $sum: '$voteQuantity' }
                    }
                }
            ]);
            return result.length > 0 ? result[0].totalVotes : 0;
        } catch (error: any) {
            log.error(`Error summing votes for entrepreneur ${entrepreneurId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Counts total amount collected for an entrepreneur.
     */
    async sumAmountByEntrepreneur(entrepreneurId: string | Types.ObjectId): Promise<number> {
        try {
            const result = await ChallengeVoteModel.aggregate([
                {
                    $match: {
                        entrepreneurId: new Types.ObjectId(entrepreneurId.toString()),
                        paymentStatus: VotePaymentStatus.COMPLETED
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$amountPaid' }
                    }
                }
            ]);
            return result.length > 0 ? result[0].totalAmount : 0;
        } catch (error: any) {
            log.error(`Error summing amount for entrepreneur ${entrepreneurId}: ${error.message}`);
            throw error;
        }
    }
}

// Export a singleton instance
export const challengeVoteRepository = new ChallengeVoteRepository();
