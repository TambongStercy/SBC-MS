import { Types } from 'mongoose';
import { productRepository, ProductSearchFilters, AdminProductSearchFilters } from '../database/repositories/product.repository';
import { ratingRepository } from '../database/repositories/rating.repository';
import { IProduct, ProductStatus, IProductImage } from '../database/models/product.model';
import { IRating } from '../database/models/rating.model';
import { CustomError } from '../utils/custom-error';
import { settingsServiceClient } from '../services/clients/settings.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('ProductService');

export class ProductService {
    /**
     * Create a new product
     * @param productData Product data (excluding images)
     * @param imageFiles Array of uploaded image files
     * @returns Created product
     */
    async createProduct(
        productData: Omit<Partial<IProduct>, 'images'>, // Exclude images from initial data
        imageFiles: Express.Multer.File[] = [] // Accept image files
    ): Promise<IProduct> {
        log.info(`Creating new product for user ${productData.userId}`);
        try {
            const uploadedImages: IProductImage[] = [];

            // 1. Upload Images to Settings Service
            if (imageFiles && imageFiles.length > 0) {
                log.info(`Uploading ${imageFiles.length} images for product...`);
                const uploadPromises = imageFiles.map(file =>
                    settingsServiceClient.uploadFile(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        'product-docs' // Specify folder name for product images
                    ).then((uploadResult: { fileId: string }) => ({
                        fileId: uploadResult.fileId,
                        // Construct proxy URL pointing to settings-service endpoint
                        url: `/settings/files/${uploadResult.fileId}`
                    }))
                );
                const results = await Promise.all(uploadPromises);
                uploadedImages.push(...results);
                log.info('Product images uploaded successfully.');
            }

            // 2. Prepare product data for saving
            const newProductData: Partial<IProduct> = {
                ...productData,
                images: uploadedImages, // Add uploaded image details
                overallRating: 0,
                ratings: [],
                status: ProductStatus.PENDING // Ensure status is pending
            };

            // 3. Create product in repository
            return await productRepository.create(newProductData);
        } catch (error: any) {
            log.error('Error creating product:', error);
            // Consider deleting uploaded files if creation fails (complex)
            throw new CustomError(error.message || 'Failed to create product', error.statusCode || 500);
        }
    }

    /**
     * Get a product by ID
     * @param productId Product ID
     * @returns Product or null if not found
     */
    async getProductById(productId: string | Types.ObjectId): Promise<IProduct | null> {
        try {
            const product = await productRepository.findById(productId);
            if (!product) {
                throw new CustomError('Product not found', 404);
            }
            return product;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error getting product by ID:', error);
            throw new CustomError('Failed to get product', 500);
        }
    }

    /**
     * Get products by user ID
     * @param userId User ID
     * @returns Array of products
     */
    async getProductsByUserId(userId: string | Types.ObjectId): Promise<IProduct[]> {
        try {
            return await productRepository.findByUserId(userId);
        } catch (error) {
            console.error('Error getting products by user ID:', error);
            throw new CustomError('Failed to get user products', 500);
        }
    }

    /**
     * Update a product
     * @param productId Product ID
     * @param updateData Data to update (excluding images)
     * @param imageFiles Optional new image files to replace existing ones
     * @param userId User ID of the requester (for authorization)
     * @param isAdmin Is the requester an admin
     * @returns Updated product
     */
    async updateProduct(
        productId: string | Types.ObjectId,
        updateData: Omit<Partial<IProduct>, 'images'>,
        imageFiles?: Express.Multer.File[], // Accept optional image files
        userId?: string | Types.ObjectId,
        isAdmin?: boolean
    ): Promise<IProduct | null> {
        log.info(`Updating product ${productId} for user ${userId || 'Admin'}`);
        try {
            const product = await productRepository.findById(productId);
            if (!product) {
                throw new CustomError('Product not found', 404);
            }

            // Authorization check
            if (!isAdmin && product.userId.toString() !== userId?.toString()) {
                throw new CustomError('Unauthorized: You do not own this product', 403);
            }

            const safeUpdateData: Partial<IProduct> = { ...updateData };
            // Remove fields that shouldn't be directly updated this way
            delete safeUpdateData.ratings;
            delete safeUpdateData.overallRating;
            delete safeUpdateData.userId; // Cannot change owner
            delete safeUpdateData.status; // Status updated via separate method
            delete safeUpdateData.images; // Images handled separately below

            // 1. Handle Image Updates (Replace Strategy)
            if (imageFiles && imageFiles.length > 0) {
                log.info(`Replacing images for product ${productId} with ${imageFiles.length} new files.`);
                // TODO: Optional - Delete old files from settings-service using product.images[].fileId

                const uploadPromises = imageFiles.map(file =>
                    settingsServiceClient.uploadFile(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        'product-docs' // Specify folder name for product images
                    ).then((uploadResult: { fileId: string }) => ({
                        fileId: uploadResult.fileId,
                        url: `/settings/files/${uploadResult.fileId}`
                    }))
                );
                safeUpdateData.images = await Promise.all(uploadPromises);
                log.info('New product images uploaded and processed.');
            }

            // 2. Perform the update
            return await productRepository.updateById(productId, safeUpdateData);

        } catch (error: any) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error(`Error updating product ${productId}:`, error);
            throw new CustomError('Failed to update product', 500);
        }
    }

    /**
     * Update product status (admin only)
     * @param productId Product ID
     * @param status New status
     * @param rejectionReason Optional reason for rejection
     * @returns Updated product
     */
    async updateProductStatus(
        productId: string | Types.ObjectId,
        status: string,
        rejectionReason?: string
    ): Promise<IProduct | null> {
        try {
            return await productRepository.updateStatus(productId, status as ProductStatus, rejectionReason);
        } catch (error) {
            console.error('Error updating product status:', error);
            throw new CustomError('Failed to update product status', 500);
        }
    }

    /**
     * Delete a product (soft delete)
     * @param productId Product ID
     * @param userId User ID of the requester (for authorization)
     * @returns Deleted product
     */
    async deleteProduct(
        productId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<IProduct | null> {
        try {
            // Verify product ownership
            const product = await productRepository.findById(productId);
            if (!product) {
                throw new CustomError('Product not found', 404);
            }

            if (product.userId.toString() !== userId.toString()) {
                throw new CustomError('Unauthorized: You do not own this product', 403);
            }

            return await productRepository.softDelete(productId);
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error deleting product:', error);
            throw new CustomError('Failed to delete product', 500);
        }
    }

    /**
     * [Admin] List products with extended filtering and pagination
     * @param filters Admin-specific search filters including status
     * @returns Products matching the criteria with pagination info
     */
    async adminListProducts(filters: AdminProductSearchFilters) {
        try {
            // Call the repository method designed for admin listing
            return await productRepository.adminSearchProducts(filters);
        } catch (error) {
            console.error('Error listing products (admin):', error);
            throw new CustomError('Failed to list products', 500);
        }
    }

    /**
     * Restore a deleted product (admin only)
     * @param productId Product ID
     * @returns Restored product
     */
    async restoreProduct(productId: string | Types.ObjectId): Promise<IProduct | null> {
        try {
            return await productRepository.restore(productId);
        } catch (error) {
            console.error('Error restoring product:', error);
            throw new CustomError('Failed to restore product', 500);
        }
    }

    /**
     * Search products with filters
     * @param filters Search filters
     * @returns Products matching the criteria with pagination info
     */
    async searchProducts(filters: ProductSearchFilters) {
        try {
            return await productRepository.searchProducts(filters);
        } catch (error) {
            console.error('Error searching products:', error);
            throw new CustomError('Failed to search products', 500);
        }
    }

    /**
     * Add a rating to a product
     * @param productId Product ID
     * @param ratingData Rating data
     * @returns The created or updated rating
     */
    async rateProduct(
        productId: string | Types.ObjectId,
        ratingData: Partial<IRating>
    ): Promise<IRating> {
        try {
            const product = await productRepository.findById(productId);
            if (!product) {
                throw new CustomError('Product not found', 404);
            }

            // Check if user has already rated this product
            const existingRating = await ratingRepository.findByUserAndProduct(
                ratingData.userId!,
                productId
            );

            let rating: IRating;

            if (existingRating) {
                // Update existing rating
                const updatedRating = await ratingRepository.updateById(
                    existingRating._id,
                    {
                        rating: ratingData.rating,
                        review: ratingData.review
                    }
                );

                if (!updatedRating) {
                    throw new CustomError('Failed to update rating', 500);
                }

                rating = updatedRating;
            } else {
                // Create new rating
                // Ensure productId is ObjectId before creating rating data
                const objectIdProductId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;

                const newRatingData: Partial<IRating> = {
                    ...ratingData,
                    productId: objectIdProductId, // Use the converted ObjectId
                    helpful: 0
                };

                rating = await ratingRepository.create(newRatingData);

                // Add rating ID to product
                await productRepository.addRating(productId, rating._id);
            }

            // Calculate and update the overall product rating
            const averageRating = await ratingRepository.calculateAverageRating(productId);
            if (averageRating !== null) {
                await productRepository.updateOverallRating(productId, averageRating);
            }

            return rating;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error rating product:', error);
            throw new CustomError('Failed to rate product', 500);
        }
    }

    /**
     * Delete a rating from a product
     * @param ratingId Rating ID
     * @param userId User ID of the requester (for authorization)
     * @returns Result of deletion
     */
    async deleteRating(
        ratingId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<{ success: boolean; message: string }> {
        try {
            const rating = await ratingRepository.findById(ratingId);
            if (!rating) {
                throw new CustomError('Rating not found', 404);
            }

            // Verify rating ownership
            if (rating.userId.toString() !== userId.toString()) {
                throw new CustomError('Unauthorized: You do not own this rating', 403);
            }

            const productId = rating.productId;

            // Soft delete the rating
            await ratingRepository.softDelete(ratingId);

            // Remove rating from product
            await productRepository.removeRating(productId, ratingId);

            // Recalculate overall product rating
            const averageRating = await ratingRepository.calculateAverageRating(productId);
            if (averageRating !== null) {
                await productRepository.updateOverallRating(productId, averageRating);
            } else {
                // If no ratings left, set overall rating to 0
                await productRepository.updateOverallRating(productId, 0);
            }

            return { success: true, message: 'Rating deleted successfully' };
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error deleting rating:', error);
            throw new CustomError('Failed to delete rating', 500);
        }
    }

    /**
     * Mark a rating as helpful by a specific user
     * @param ratingId Rating ID
     * @param userId User ID marking as helpful
     * @returns Updated rating or null
     * @throws CustomError if rating not found or user already voted
     */
    async markRatingAsHelpful(
        ratingId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<IRating | null> {
        try {
            // Use the repository method that adds the user ID to the set
            const updatedRating = await ratingRepository.addHelpfulVote(ratingId, userId);

            if (!updatedRating) {
                // This means either the rating wasn't found OR the user already voted.
                // We might want to check the rating existence first for a clearer error.
                const ratingExists = await ratingRepository.findById(ratingId);
                if (!ratingExists) {
                    throw new CustomError('Rating not found', 404);
                }
                // If it exists, the user must have already voted.
                throw new CustomError('User has already marked this rating as helpful', 409); // 409 Conflict
            }

            return updatedRating;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            console.error('Error marking rating as helpful:', error);
            throw new CustomError('Failed to mark rating as helpful', 500);
        }
    }

    /**
     * Get ratings for a product
     * @param productId Product ID
     * @param page Page number
     * @param limit Items per page
     * @returns Ratings with pagination info
     */
    async getProductRatings(
        productId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10
    ) {
        try {
            return await ratingRepository.searchRatings({
                productId,
                page,
                limit,
                sortBy: 'helpful',
                sortOrder: 'desc'
            });
        } catch (error) {
            console.error('Error getting product ratings:', error);
            throw new CustomError('Failed to get product ratings', 500);
        }
    }

    /**
     * Get ratings by a user
     * @param userId User ID
     * @param page Page number
     * @param limit Items per page
     * @returns Ratings with pagination info
     */
    async getUserRatings(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 10
    ) {
        try {
            return await ratingRepository.searchRatings({
                userId,
                page,
                limit,
                sortBy: 'createdAt',
                sortOrder: 'desc'
            });
        } catch (error) {
            console.error('Error getting user ratings:', error);
            throw new CustomError('Failed to get user ratings', 500);
        }
    }
}

// Export an instance for easy use
export const productService = new ProductService(); 