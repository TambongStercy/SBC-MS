import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { productService } from '../../services/product.service';
import { CustomError } from '../../utils/custom-error';
import { ProductStatus } from '../../database/models/product.model';
import logger from '../../utils/logger';

// Define an interface for requests that have passed authentication
interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        role: string;
        email: string;
        // Add other user properties if needed
    };
}

const log = logger.getLogger('ProductController');

export class ProductController {
    /**
     * Create a new product
     * @route POST /api/products
     */
    async createProduct(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            // Extract fields from req.body
            const { name, category, subcategory, description, price } = req.body;
            // Get uploaded files from req.files
            const imageFiles = req.files as Express.Multer.File[];

            // Basic validation
            if (!name || !category || !description || !price) {
                throw new CustomError('Missing required fields: name, category, description, price', 400);
            }

            // Get user ID from authenticated request
            const userId = req.user?.id;
            if (!userId) {
                // This should ideally be caught by the auth middleware, but double-check
                throw new CustomError('User not authenticated', 401);
            }

            const productData = {
                userId: new Types.ObjectId(userId),
                name,
                category,
                subcategory,
                description,
                // Removed imagesUrl, images are handled by service with imageFiles
                price: parseFloat(price), // Ensure price is a number
                status: ProductStatus.APPROVED
            };

            const product = await productService.createProduct(productData, imageFiles);

            return res.status(201).json({
                success: true,
                data: product
            });
        } catch (error) {
            log.error('Error in createProduct controller:', error);
            next(error); // Pass error to the centralized error handler
        }
    }

    /**
     * Get a product by ID
     * @route GET /api/products/:productId
     */
    async getProduct(req: Request, res: Response) {
        try {
            log.info(`Getting product ${req.params.productId}`);
            const { productId } = req.params;

            if (!Types.ObjectId.isValid(productId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            const product = await productService.getProductById(productId);

            return res.json({
                success: true,
                data: product
            });
        } catch (error) {
            console.error('Error in getProduct controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get products by the current user
     * @route GET /api/products/user
     */
    async getUserProducts(req: Request, res: Response) {
        try {
            log.info(`Getting user products for user ${req.user?.id}`);
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            const products = await productService.getProductsByUserId(userId);

            return res.json({
                success: true,
                data: products
            });
        } catch (error) {
            console.error('Error in getUserProducts controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update a product
     * @route PUT /api/products/:productId
     */
    async updateProduct(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { productId } = req.params;
            const userId = req.user?.id;
            const isAdmin = req.user?.role === 'admin';
            const imageFiles = req.files as Express.Multer.File[]; // Get uploaded files

            if (!userId) {
                throw new CustomError('User not authenticated', 401);
            }

            if (!Types.ObjectId.isValid(productId)) {
                throw new CustomError('Invalid product ID', 400);
            }

            // Extract update data from the body (excluding files)
            const updateData = req.body;
            if (updateData.price) {
                updateData.price = parseFloat(updateData.price); // Ensure price is a number if provided
            }

            // Call the service method, passing the image files
            const updatedProduct = await productService.updateProduct(
                productId,
                updateData,
                imageFiles, // Pass the image files here
                userId,     // Pass userId for authorization check in service
                isAdmin     // Pass isAdmin for authorization check in service
            );

            return res.json({
                success: true,
                data: updatedProduct
            });
        } catch (error) {
            log.error('Error in updateProduct controller:', error);
            next(error); // Pass error to the centralized error handler
        }
    }

    /**
     * Delete a product (soft delete)
     * @route DELETE /api/products/:productId
     */
    async deleteProduct(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            if (!Types.ObjectId.isValid(productId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            await productService.deleteProduct(productId, userId);

            return res.json({
                success: true,
                message: 'Product deleted successfully'
            });
        } catch (error) {
            console.error('Error in deleteProduct controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update product status (admin only)
     * @route PATCH /api/products/:productId/status
     */
    async updateProductStatus(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const { status, rejectionReason } = req.body;

            if (!status || !['pending', 'approved', 'rejected'].includes(status.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status. Must be pending, approved, or rejected'
                });
            }

            if (status === 'rejected' && !rejectionReason) {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required when rejecting a product'
                });
            }

            if (!Types.ObjectId.isValid(productId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            const updatedProduct = await productService.updateProductStatus(
                productId,
                status.toLowerCase(),
                rejectionReason
            );

            return res.json({
                success: true,
                data: updatedProduct
            });
        } catch (error) {
            console.error('Error in updateProductStatus controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Search products with filters
     * @route GET /api/products/search
     */
    async searchProducts(req: Request, res: Response) {
        try {
            const {
                userId,
                category,
                subcategory,
                minPrice,
                maxPrice,
                status,
                search,
                sortBy,
                sortOrder,
                page,
                limit
            } = req.query;


            const filters: any = {};

            if (userId && typeof userId === 'string') {
                filters.userId = userId;
            }

            if (category && typeof category === 'string') {
                filters.category = category;
            }

            if (subcategory && typeof subcategory === 'string') {
                filters.subcategory = subcategory;
            }

            if (minPrice && typeof minPrice === 'string') {
                filters.minPrice = parseFloat(minPrice);
            }

            if (maxPrice && typeof maxPrice === 'string') {
                filters.maxPrice = parseFloat(maxPrice);
            }

            if (status && typeof status === 'string') {
                filters.status = status;
            }

            if (search && typeof search === 'string') {
                filters.searchTerm = search;
            }

            if (sortBy && typeof sortBy === 'string') {
                filters.sortBy = sortBy;
            }

            if (sortOrder && typeof sortOrder === 'string') {
                filters.sortOrder = sortOrder as 'asc' | 'desc';
            }

            if (page && typeof page === 'string') {
                filters.page = parseInt(page);
            }

            if (limit && typeof limit === 'string') {
                filters.limit = parseInt(limit);
            }

            const results = await productService.searchProducts(filters);

            return res.json({
                success: true,
                data: results
            });
        } catch (error) {
            console.error('Error in searchProducts controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Rate a product
     * @route POST /api/products/:productId/ratings
     */
    async rateProduct(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const { rating, review } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            if (!Types.ObjectId.isValid(productId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be an integer between 1 and 5'
                });
            }

            const ratingData = {
                userId: new Types.ObjectId(userId),
                rating,
                review: review || ''
            };

            const newRating = await productService.rateProduct(productId, ratingData);

            return res.json({
                success: true,
                data: newRating
            });
        } catch (error) {
            console.error('Error in rateProduct controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Delete a rating
     * @route DELETE /api/products/ratings/:ratingId
     */
    async deleteRating(req: Request, res: Response) {
        try {
            const { ratingId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            if (!Types.ObjectId.isValid(ratingId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid rating ID'
                });
            }

            const result = await productService.deleteRating(ratingId, userId);

            return res.json({
                success: true,
                message: result.message
            });
        } catch (error) {
            console.error('Error in deleteRating controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Mark a rating as helpful
     * @route POST /api/products/ratings/:ratingId/helpful
     */
    async markRatingAsHelpful(req: Request, res: Response) {
        try {
            const { ratingId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            if (!Types.ObjectId.isValid(ratingId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid rating ID'
                });
            }

            const updatedRating = await productService.markRatingAsHelpful(ratingId, userId);

            return res.json({
                success: true,
                data: updatedRating
            });
        } catch (error) {
            console.error('Error in markRatingAsHelpful controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get ratings for a product
     * @route GET /api/products/:productId/ratings
     */
    async getProductRatings(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const { page, limit } = req.query;

            if (!Types.ObjectId.isValid(productId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            const pageNum = page && typeof page === 'string' ? parseInt(page) : 1;
            const limitNum = limit && typeof limit === 'string' ? parseInt(limit) : 10;

            const ratings = await productService.getProductRatings(productId, pageNum, limitNum);

            return res.json({
                success: true,
                data: ratings
            });
        } catch (error) {
            console.error('Error in getProductRatings controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get ratings by the current user
     * @route GET /api/products/user/ratings
     */
    async getUserRatings(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            const { page, limit } = req.query;

            log.info(`Getting user ratings for user ${userId}`);

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated'
                });
            }

            const pageNum = page && typeof page === 'string' ? parseInt(page) : 1;
            const limitNum = limit && typeof limit === 'string' ? parseInt(limit) : 10;

            const ratings = await productService.getUserRatings(userId, pageNum, limitNum);

            return res.json({
                success: true,
                data: ratings
            });
        } catch (error) {
            console.error('Error in getUserRatings controller:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * [Admin] List all products with filtering and pagination
     * @route GET /api/products/admin
     */
    async adminListProducts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info('Admin request to list products');
        try {
            const {
                page = 1,
                limit = 10,
                status,
                searchTerm,
                userId,
                category,
                hasActiveFlashSale,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const filters = {
                status: status as string | undefined,
                searchTerm: searchTerm as string | undefined,
                userId: userId as string | undefined,
                category: category as string | undefined,
                hasActiveFlashSale: hasActiveFlashSale as string | undefined,
                page: parseInt(page as string, 10),
                limit: parseInt(limit as string, 10),
                sortBy: sortBy as string,
                sortOrder: sortOrder as 'asc' | 'desc'
            };

            // Validate numeric inputs
            if (isNaN(filters.page) || isNaN(filters.limit)) {
                log.error('Invalid pagination parameters:', filters);
                throw new CustomError('Invalid pagination parameters', 400);
            }

            log.debug('Passing filters to service:', filters);

            // Correctly type the status filter before passing to the service
            const serviceFilters = {
                ...filters,
                status: filters.status as ProductStatus | 'deleted' | 'all' | undefined,
            };

            const result = await productService.adminListProducts(serviceFilters);

            res.status(200).json({
                success: true,
                data: result.products,
                pagination: result.paginationInfo
            });
        } catch (error) {
            log.error('Error in adminListProducts:', error);
            next(error); // Pass to global error handler
        }
    }

    /**
     * [Admin] Restore a soft-deleted product
     * @route PATCH /api/products/admin/:productId/restore
     */
    async adminRestoreProduct(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.info(`Admin request to restore product: ${req.params.productId}`);
        try {
            const { productId } = req.params;
            const restoredProduct = await productService.restoreProduct(productId);
            if (!restoredProduct) {
                throw new CustomError('Product not found or already restored', 404);
            }
            res.status(200).json({ success: true, message: 'Product restored successfully', data: restoredProduct });
        } catch (error) {
            log.error('Error restoring product (admin):', error);
            next(error);
        }
    }

    /**
     * [Admin] Hard delete a product (Use with extreme caution!)
     * @route DELETE /api/products/admin/:productId/hard
     */
    async adminHardDeleteProduct(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        log.warn(`ADMIN HARD DELETE requested for product: ${req.params.productId}`);
        // Add extra confirmation logic if possible
        try {
            const { productId } = req.params;
            // TODO: Implement hard delete in service/repository if needed
            // await productService.hardDeleteProduct(productId); 
            log.warn(`Placeholder: Hard delete not implemented for ${productId}`);
            res.status(501).json({ success: false, message: 'Hard delete endpoint not implemented.' });
            // If implemented: res.status(200).json({ success: true, message: 'Product permanently deleted' });
        } catch (error) {
            log.error('Error during hard delete (admin):', error);
            next(error);
        }
    }
}

// Export an instance for easy use
export const productController = new ProductController(); 