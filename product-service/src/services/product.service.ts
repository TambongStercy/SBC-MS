import { Types } from 'mongoose';
import { productRepository, ProductSearchFilters, AdminProductSearchFilters } from '../database/repositories/product.repository';
import { ratingRepository } from '../database/repositories/rating.repository';
import { IProduct, ProductStatus, IProductImage } from '../database/models/product.model';
import { IRating } from '../database/models/rating.model';
import { CustomError } from '../utils/custom-error';
import { settingsServiceClient } from '../services/clients/settings.service.client';
import { userServiceClient, UserDetails } from '../services/clients/user.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('ProductService');



// Define a type for the product augmented with a WhatsApp link
type ProductWithWhatsappLink = IProduct & { whatsappLink?: string };

// Define a local pagination response type if not reliably importable
interface ProductPaginationResponse {
    products: IProduct[]; // Assuming the repository uses 'products' field
    paginationInfo: {
        totalCount: number;
        totalPages: number;
        currentPage: number;
        limit: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        // Add nextPage and prevPage if they exist in the actual repo response
        nextPage?: number;
        prevPage?: number;
    };
}

export class ProductService {
    /**
     * Helper to generate WhatsApp link from a phone number.
     * @param phoneNumber Phone number (preferably in international format)
     * @returns WhatsApp link string or undefined.
     */
    private generateWhatsAppLink(phoneNumber?: string): string | undefined {
        if (!phoneNumber) return undefined;
        // Remove all non-digit characters except '+' at the beginning
        const cleanedNumber = phoneNumber.replace(/(?!^\+)[^0-9]/g, '');
        if (!cleanedNumber) return undefined;
        // If it starts with '+', remove it for wa.me link if it's common practice, otherwise keep it.
        // wa.me typically expects the number without '+' but includes country code.
        const finalNumber = cleanedNumber.startsWith('+') ? cleanedNumber.substring(1) : cleanedNumber;
        return `https://wa.me/${finalNumber}`;
    }

    /**
     * Augments a single product with a WhatsApp link.
     * @param product The product document or plain object.
     * @returns Product object with whatsappLink.
     */
    private async augmentProductWithWhatsappLink(
        product: IProduct | ProductWithWhatsappLink // Accept either mongoose doc or plain object
    ): Promise<ProductWithWhatsappLink> {
        // No longer need to call .toObject() if product might already be plain
        // Work with the input object directly, assuming it has IProduct fields
        const plainProduct: ProductWithWhatsappLink = { ...product } as ProductWithWhatsappLink;

        if (!plainProduct.userId) {
            return plainProduct; // Return as is if no userId
        }
        try {
            const userDetailsArray = await userServiceClient.getUsersByIds([plainProduct.userId.toString()]);
            if (userDetailsArray && userDetailsArray.length > 0) {
                const user = userDetailsArray[0];
                plainProduct.whatsappLink = this.generateWhatsAppLink(user.phoneNumber?.toString());
            }
        } catch (error) {
            log.error(`Failed to fetch user details for WhatsApp link (product ${plainProduct._id}):`, error);
            // whatsappLink will remain undefined
        }
        return plainProduct;
    }

    /**
     * Augments multiple products with WhatsApp links using a batch fetch for user details.
     * @param products Array of product documents or plain objects.
     * @returns Array of product objects with whatsappLink.
     */
    private async augmentProductsWithWhatsappLink(
        products: IProduct[] // Assume input is array of plain objects from aggregation
    ): Promise<ProductWithWhatsappLink[]> {
        if (!products || products.length === 0) {
            return [];
        }

        // Work directly with the input array (plain objects)
        const plainProducts: ProductWithWhatsappLink[] = products.map(p => ({ ...p } as ProductWithWhatsappLink));
        const userIds = Array.from(new Set(plainProducts.map(p => p.userId?.toString()).filter(id => !!id)));

        if (userIds.length === 0) {
            return plainProducts; // Return as is if no userIds to fetch
        }

        const userDetailsMap = new Map<string, UserDetails>();
        try {
            const userDetailsArray = await userServiceClient.getUsersByIds(userIds as string[]); // Cast to string[] is fine here
            userDetailsArray.forEach((ud: UserDetails) => userDetailsMap.set(ud._id.toString(), ud));
        } catch (error) {
            log.error('Failed to fetch user details in batch for WhatsApp links:', error);
        }

        // Add whatsappLink to each plain product object
        return plainProducts.map(p => {
            const userDetail = p.userId ? userDetailsMap.get(p.userId.toString()) : undefined;
            p.whatsappLink = userDetail ? this.generateWhatsAppLink(userDetail.phoneNumber) : undefined;
            return p;
        });
    }

    /**
     * Create a new product
     * @param productData Product data (excluding images)
     * @param imageFiles Array of uploaded image files
     * @returns Created product with whatsappLink
     */
    async createProduct(
        productData: Omit<Partial<IProduct>, 'images'>, // Exclude images from initial data
        imageFiles: Express.Multer.File[] = [] // Accept image files
    ): Promise<ProductWithWhatsappLink> {
        log.info(`Creating new product for user ${productData.userId}`);
        try {
            const uploadedImages: IProductImage[] = [];

            if (imageFiles && imageFiles.length > 0) {
                log.info(`Uploading ${imageFiles.length} images for product...`);
                const uploadPromises = imageFiles.map(file =>
                    settingsServiceClient.uploadFile(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        'product-docs'
                    ).then((uploadResult: { fileId: string }) => ({
                        fileId: uploadResult.fileId,
                        url: `/settings/files/${uploadResult.fileId}`
                    }))
                );
                const results = await Promise.all(uploadPromises);
                uploadedImages.push(...results);
                log.info('Product images uploaded successfully.');
            }

            const newProductData: Partial<IProduct> = {
                ...productData,
                images: uploadedImages,
                overallRating: 0,
                ratings: [],
                status: ProductStatus.PENDING
            };

            const createdProductDoc = await productRepository.create(newProductData);
            return this.augmentProductWithWhatsappLink(createdProductDoc);
        } catch (error: any) {
            log.error('Error creating product:', error);
            throw new CustomError(error.message || 'Failed to create product', error.statusCode || 500);
        }
    }

    /**
     * Get a product by ID
     * @param productId Product ID
     * @returns Product with whatsappLink or null if not found
     */
    async getProductById(productId: string | Types.ObjectId): Promise<ProductWithWhatsappLink | null> {
        try {
            const productDoc = await productRepository.findById(productId);
            if (!productDoc) {
                throw new CustomError('Product not found', 404);
            }
            return this.augmentProductWithWhatsappLink(productDoc);
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error('Error getting product by ID:', error);
            throw new CustomError('Failed to get product', 500);
        }
    }

    /**
     * Get products by user ID
     * @param userId User ID
     * @returns Array of products with whatsappLink
     */
    async getProductsByUserId(userId: string | Types.ObjectId): Promise<ProductWithWhatsappLink[]> {
        try {
            const productDocs = await productRepository.findByUserId(userId);
            return this.augmentProductsWithWhatsappLink(productDocs);
        } catch (error) {
            log.error('Error getting products by user ID:', error);
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
     * @returns Updated product with whatsappLink
     */
    async updateProduct(
        productId: string | Types.ObjectId,
        updateData: Omit<Partial<IProduct>, 'images'>,
        imageFiles?: Express.Multer.File[],
        userId?: string | Types.ObjectId,
        isAdmin?: boolean
    ): Promise<ProductWithWhatsappLink | null> {
        log.info(`Updating product ${productId} for user ${userId || 'Admin'}`);
        try {
            const productDoc = await productRepository.findById(productId);
            if (!productDoc) {
                throw new CustomError('Product not found', 404);
            }

            if (!isAdmin && productDoc.userId.toString() !== userId?.toString()) {
                throw new CustomError('Unauthorized: You do not own this product', 403);
            }

            const safeUpdateData: Partial<IProduct> = { ...updateData };
            delete safeUpdateData.ratings;
            delete safeUpdateData.overallRating;
            delete safeUpdateData.userId;
            delete safeUpdateData.status;
            delete safeUpdateData.images;

            if (imageFiles && imageFiles.length > 0) {
                log.info(`Replacing images for product ${productId} with ${imageFiles.length} new files.`);
                const uploadPromises = imageFiles.map(file =>
                    settingsServiceClient.uploadFile(
                        file.buffer,
                        file.mimetype,
                        file.originalname,
                        'product-docs'
                    ).then((uploadResult: { fileId: string }) => ({
                        fileId: uploadResult.fileId,
                        url: `/settings/files/${uploadResult.fileId}`
                    }))
                );
                safeUpdateData.images = await Promise.all(uploadPromises);
                log.info('New product images uploaded and processed.');
            }

            const updatedProductDoc = await productRepository.updateById(productId, safeUpdateData);
            if (!updatedProductDoc) return null;
            return this.augmentProductWithWhatsappLink(updatedProductDoc);

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
     * @returns Updated product with whatsappLink
     */
    async updateProductStatus(
        productId: string | Types.ObjectId,
        status: string,
        rejectionReason?: string
    ): Promise<ProductWithWhatsappLink | null> {
        try {
            const updatedProductDoc = await productRepository.updateStatus(productId, status as ProductStatus, rejectionReason);
            if (!updatedProductDoc) return null;
            return this.augmentProductWithWhatsappLink(updatedProductDoc);
        } catch (error) {
            log.error('Error updating product status:', error);
            throw new CustomError('Failed to update product status', 500);
        }
    }

    /**
     * Delete a product (soft delete)
     * @param productId Product ID
     * @param userId User ID of the requester (for authorization)
     * @returns Deleted product with whatsappLink
     */
    async deleteProduct(
        productId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<ProductWithWhatsappLink | null> {
        try {
            const productDoc = await productRepository.findById(productId);
            if (!productDoc) {
                throw new CustomError('Product not found', 404);
            }

            if (productDoc.userId.toString() !== userId.toString()) {
                throw new CustomError('Unauthorized: You do not own this product', 403);
            }

            const deletedProductDoc = await productRepository.softDelete(productId);
            if (!deletedProductDoc) return null;
            return this.augmentProductWithWhatsappLink(deletedProductDoc);
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error('Error deleting product:', error);
            throw new CustomError('Failed to delete product', 500);
        }
    }

    /**
     * [Admin] List products with extended filtering and pagination
     * @param filters Admin-specific search filters including status
     * @returns Products matching the criteria with pagination info and whatsappLink
     */
    async adminListProducts(filters: AdminProductSearchFilters): Promise<Omit<ProductPaginationResponse, 'products'> & { products: ProductWithWhatsappLink[] }> {
        try {
            const result = await productRepository.adminSearchProducts(filters);
            const augmentedProducts = await this.augmentProductsWithWhatsappLink(result.products);
            return { ...result, products: augmentedProducts };
        } catch (error) {
            log.error('Error listing products (admin):', error);
            throw new CustomError('Failed to list products', 500);
        }
    }

    /**
     * Restore a deleted product (admin only)
     * @param productId Product ID
     * @returns Restored product with whatsappLink
     */
    async restoreProduct(productId: string | Types.ObjectId): Promise<ProductWithWhatsappLink | null> {
        try {
            const restoredProductDoc = await productRepository.restore(productId);
            if (!restoredProductDoc) return null;
            return this.augmentProductWithWhatsappLink(restoredProductDoc);
        } catch (error) {
            log.error('Error restoring product:', error);
            throw new CustomError('Failed to restore product', 500);
        }
    }

    /**
     * Search products with filters
     * @param filters Search filters
     * @returns Products matching the criteria with pagination info and whatsappLink
     */
    async searchProducts(filters: ProductSearchFilters): Promise<Omit<ProductPaginationResponse, 'products'> & { products: ProductWithWhatsappLink[] }> {
        try {
            const result = await productRepository.searchProducts(filters);
            const augmentedProducts = await this.augmentProductsWithWhatsappLink(result.products);
            return { ...result, products: augmentedProducts };
        } catch (error) {
            log.error('Error searching products:', error);
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

            const existingRating = await ratingRepository.findByUserAndProduct(
                ratingData.userId!,
                productId
            );

            let rating: IRating;

            if (existingRating) {
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
                const objectIdProductId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
                const newRatingData: Partial<IRating> = {
                    ...ratingData,
                    productId: objectIdProductId,
                    helpful: 0
                };
                rating = await ratingRepository.create(newRatingData);
                await productRepository.addRating(productId, rating._id);
            }

            const averageRating = await ratingRepository.calculateAverageRating(productId);
            if (averageRating !== null) {
                await productRepository.updateOverallRating(productId, averageRating);
            }
            return rating;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error('Error rating product:', error);
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

            if (rating.userId.toString() !== userId.toString()) {
                throw new CustomError('Unauthorized: You do not own this rating', 403);
            }

            const productId = rating.productId;
            await ratingRepository.softDelete(ratingId);
            await productRepository.removeRating(productId, ratingId);

            const averageRating = await ratingRepository.calculateAverageRating(productId);
            await productRepository.updateOverallRating(productId, averageRating !== null ? averageRating : 0);

            return { success: true, message: 'Rating deleted successfully' };
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error('Error deleting rating:', error);
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
            const updatedRating = await ratingRepository.addHelpfulVote(ratingId, userId);
            if (!updatedRating) {
                const ratingExists = await ratingRepository.findById(ratingId);
                if (!ratingExists) {
                    throw new CustomError('Rating not found', 404);
                }
                throw new CustomError('User has already marked this rating as helpful', 409);
            }
            return updatedRating;
        } catch (error) {
            if (error instanceof CustomError) {
                throw error;
            }
            log.error('Error marking rating as helpful:', error);
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
            log.error('Error getting product ratings:', error);
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
            log.error('Error getting user ratings:', error);
            throw new CustomError('Failed to get user ratings', 500);
        }
    }
}

// Export an instance for easy use
export const productService = new ProductService(); 