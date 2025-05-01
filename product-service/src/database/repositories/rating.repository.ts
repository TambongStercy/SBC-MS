import { Types } from 'mongoose';
import RatingModel, { IRating } from '../models/rating.model';

export interface RatingSearchFilters {
    userId?: string | Types.ObjectId;
    productId?: string | Types.ObjectId;
    minRating?: number;
    maxRating?: number;
    hasReview?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

export interface RatingSearchResponse {
    ratings: Partial<IRating>[];
    totalCount: number;
    totalPages: number;
    page: number;
}

export class RatingRepository {
    /**
     * Create a new rating
     * @param ratingData Rating data to create
     * @returns Created rating
     */
    async create(ratingData: Partial<IRating>): Promise<IRating> {
        const rating = new RatingModel(ratingData);
        return await rating.save();
    }

    /**
     * Find a rating by ID
     * @param ratingId Rating ID
     * @returns Rating or null if not found
     */
    async findById(ratingId: string | Types.ObjectId): Promise<IRating | null> {
        return await RatingModel.findById(ratingId).exec();
    }

    /**
     * Find a user's rating for a specific product
     * @param userId User ID
     * @param productId Product ID
     * @returns Rating or null if not found
     */
    async findByUserAndProduct(
        userId: string | Types.ObjectId,
        productId: string | Types.ObjectId
    ): Promise<IRating | null> {
        return await RatingModel.findOne({
            userId,
            productId
        }).exec();
    }

    /**
     * Find all ratings for a product
     * @param productId Product ID
     * @returns Array of ratings
     */
    async findByProductId(productId: string | Types.ObjectId): Promise<IRating[]> {
        return await RatingModel.find({ productId }).exec();
    }

    /**
     * Find all ratings by a user
     * @param userId User ID
     * @returns Array of ratings
     */
    async findByUserId(userId: string | Types.ObjectId): Promise<IRating[]> {
        return await RatingModel.find({ userId }).exec();
    }

    /**
     * Update a rating by ID
     * @param ratingId Rating ID
     * @param updateData Data to update
     * @returns Updated rating or null if not found
     */
    async updateById(ratingId: string | Types.ObjectId, updateData: Partial<IRating>): Promise<IRating | null> {
        return await RatingModel.findByIdAndUpdate(
            ratingId,
            updateData,
            { new: true }
        ).exec();
    }

    /**
     * Increment the helpful count for a rating
     * @param ratingId Rating ID
     * @returns Updated rating or null if not found
     */
    async incrementHelpful(ratingId: string | Types.ObjectId): Promise<IRating | null> {
        return await RatingModel.findByIdAndUpdate(
            ratingId,
            { $inc: { helpful: 1 } },
            { new: true }
        ).exec();
    }

    /**
     * Adds a user ID to the helpfulVotes array and increments helpful count 
     * only if the user hasn't voted before.
     * @param ratingId Rating ID
     * @param userId User ID voting
     * @returns Updated rating or null if not found or vote already exists.
     */
    async addHelpfulVote(ratingId: string | Types.ObjectId, userId: string | Types.ObjectId): Promise<IRating | null> {
        try {
            const result = await RatingModel.findOneAndUpdate(
                {
                    _id: ratingId,
                    helpfulVotes: { $ne: userId } // Condition: Only update if userId NOT already in array
                },
                {
                    $inc: { helpful: 1 }, // Increment counter
                    $addToSet: { helpfulVotes: userId } // Add userId to set (prevents duplicates)
                },
                { new: true } // Return the updated document
            ).exec();

            // If result is null, it means the user was already in the array or the rating didn't exist.
            return result;
        } catch (error) {
            console.error('Error adding helpful vote:', error);
            throw error;
        }
    }

    /**
     * Soft delete a rating
     * @param ratingId Rating ID
     * @returns Deleted rating or null if not found
     */
    async softDelete(ratingId: string | Types.ObjectId): Promise<IRating | null> {
        return await RatingModel.findByIdAndUpdate(
            ratingId,
            {
                deleted: true,
                deletedAt: new Date()
            },
            { new: true }
        ).exec();
    }

    /**
     * Calculate the average rating for a product
     * @param productId Product ID
     * @returns Average rating or null if no ratings
     */
    async calculateAverageRating(productId: string | Types.ObjectId): Promise<number | null> {
        const result = await RatingModel.aggregate([
            { $match: { productId: new Types.ObjectId(productId.toString()), deleted: { $ne: true } } },
            { $group: { _id: null, average: { $avg: '$rating' } } }
        ]).exec();

        if (result.length === 0 || result[0].average === undefined) {
            return null;
        }

        return parseFloat(result[0].average.toFixed(1));
    }

    /**
     * Search ratings with filters
     * @param filters Search filters
     * @returns Ratings matching the criteria with pagination info
     */
    async searchRatings(filters: RatingSearchFilters): Promise<RatingSearchResponse> {
        try {
            // Build query based on filters
            const query: any = {};

            // Add user filter if specified
            if (filters.userId) {
                query.userId = filters.userId;
            }

            // Add product filter if specified
            if (filters.productId) {
                query.productId = filters.productId;
            }

            // Add rating range filter if specified
            if (filters.minRating !== undefined || filters.maxRating !== undefined) {
                query.rating = {};

                if (filters.minRating !== undefined) {
                    query.rating.$gte = filters.minRating;
                }

                if (filters.maxRating !== undefined) {
                    query.rating.$lte = filters.maxRating;
                }
            }

            // Filter by presence of review if specified
            if (filters.hasReview !== undefined) {
                if (filters.hasReview) {
                    query.review = { $exists: true, $ne: '' };
                } else {
                    query.$or = [
                        { review: { $exists: false } },
                        { review: '' }
                    ];
                }
            }

            // Set pagination values
            const page = filters.page || 1;
            const limit = filters.limit || 20;
            const skip = (page - 1) * limit;

            // Determine sort options
            const sortOptions: any = {};
            const sortField = filters.sortBy || 'createdAt';
            const sortDirection = filters.sortOrder === 'asc' ? 1 : -1;
            sortOptions[sortField] = sortDirection;

            // Execute query with pagination
            const ratings = await RatingModel.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .lean();

            // Get total count for pagination
            const totalCount = await RatingModel.countDocuments(query);

            return {
                ratings,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                page
            };
        } catch (error) {
            console.error('Error in searchRatings:', error);
            throw error;
        }
    }
}

// Export an instance for easy use
export const ratingRepository = new RatingRepository(); 