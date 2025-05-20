import { Types, FilterQuery } from 'mongoose';
import ProductModel, { IProduct, ProductStatus } from '../models/product.model';
import FlashSaleModel, { FlashSaleStatus } from '../models/flashsale.model';
// import logger from '../../utils/logger';

// const log = logger.getLogger('ProductRepository');

// Define search filter types
export interface ProductSearchFilters {
    userId?: string | Types.ObjectId;
    category?: string;
    subcategory?: string;
    priceMin?: number;
    priceMax?: number;
    status?: ProductStatus;
    searchTerm?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
}

// Extended Filters for Admin
export interface AdminProductSearchFilters extends Omit<ProductSearchFilters, 'status'> { // Omit base status to redefine
    status?: ProductStatus | 'all' | 'deleted'; // Allow specific status, all, or deleted
    hasActiveFlashSale?: boolean | string; // <-- Add this filter option
    // Add any other admin-specific filters here
}

export interface ProductSearchResponse {
    products: Partial<IProduct>[];
    totalCount: number;
    totalPages: number;
    page: number;
}

export class ProductRepository {
    /**
     * Create a new product
     * @param productData Product data to create
     * @returns Created product
     */
    async create(productData: Partial<IProduct>): Promise<IProduct> {
        const product = new ProductModel(productData);
        return await product.save();
    }

    /**
     * Find a product by ID
     * @param productId Product ID
     * @param includeDeleted Whether to include soft-deleted products
     * @returns Product or null if not found
     */
    async findById(productId: string | Types.ObjectId, includeDeleted = false): Promise<IProduct | null> {
        const query = ProductModel.findById(productId);

        if (includeDeleted) {
            query.where({ $or: [{ deleted: false }, { deleted: true }] });
        }

        return await query.lean().exec();
    }

    /**
     * Find products by user ID
     * @param userId User ID
     * @returns Array of products
     */
    async findByUserId(userId: string | Types.ObjectId): Promise<IProduct[]> {
        return await ProductModel.find({ userId }).exec();
    }

    /**
     * Update a product by ID
     * @param productId Product ID
     * @param updateData Data to update
     * @returns Updated product or null if not found
     */
    async updateById(productId: string | Types.ObjectId, updateData: Partial<IProduct>): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            updateData,
            { new: true }
        ).exec();
    }

    /**
     * Update product status
     * @param productId Product ID
     * @param status New status
     * @param rejectionReason Reason for rejection (if applicable)
     * @returns Updated product or null if not found
     */
    async updateStatus(
        productId: string | Types.ObjectId,
        status: ProductStatus,
        rejectionReason?: string
    ): Promise<IProduct | null> {
        const updateData: Partial<IProduct> = { status };

        if (status === ProductStatus.REJECTED && rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }

        return await this.updateById(productId, updateData);
    }

    /**
     * Soft delete a product
     * @param productId Product ID
     * @returns Deleted product or null if not found
     */
    async softDelete(productId: string | Types.ObjectId): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            {
                deleted: true,
                deletedAt: new Date()
            },
            { new: true }
        ).exec();
    }

    /**
     * Restore a soft-deleted product
     * @param productId Product ID
     * @returns Restored product or null if not found
     */
    async restore(productId: string | Types.ObjectId): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            {
                deleted: false,
                deletedAt: undefined
            },
            { new: true }
        ).where({ deleted: true }).exec();
    }

    /**
     * Add a rating reference to a product
     * @param productId Product ID
     * @param ratingId Rating ID
     * @returns Updated product or null if not found
     */
    async addRating(productId: string | Types.ObjectId, ratingId: string | Types.ObjectId): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            { $push: { ratings: ratingId } },
            { new: true }
        ).exec();
    }

    /**
     * Remove a rating reference from a product
     * @param productId Product ID
     * @param ratingId Rating ID
     * @returns Updated product or null if not found
     */
    async removeRating(productId: string | Types.ObjectId, ratingId: string | Types.ObjectId): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            { $pull: { ratings: ratingId } },
            { new: true }
        ).exec();
    }

    /**
     * Update overall rating of a product
     * @param productId Product ID
     * @param overallRating New overall rating
     * @returns Updated product or null if not found
     */
    async updateOverallRating(productId: string | Types.ObjectId, overallRating: number): Promise<IProduct | null> {
        return await ProductModel.findByIdAndUpdate(
            productId,
            { overallRating },
            { new: true }
        ).exec();
    }

    /**
     * [Admin] Search products using aggregation for advanced filtering (including flash sale status)
     * @param filters Admin search filters
     * @returns Paginated list of products
     */
    async adminSearchProducts(filters: AdminProductSearchFilters): Promise<{ products: IProduct[]; paginationInfo: any }> {

        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            status = 'all',
            priceMin,
            priceMax,
            hasActiveFlashSale,
            ...otherFilters
        } = filters;
        const skip = (page - 1) * limit;
        const now = new Date();

        // --- Build Aggregation Pipeline --- 
        const pipeline: any[] = [];

        // --- Initial Match Stage (Based on Product fields) ---
        const initialMatch: FilterQuery<IProduct> = {};
        // Status and Deleted filter
        if (status && status !== 'all') {
            if (status === 'deleted') {
                initialMatch.deleted = true;
            } else if (Object.values(ProductStatus).includes(status as ProductStatus)) {
                initialMatch.status = status as ProductStatus;
                initialMatch.deleted = { $ne: true };
            }
        } else if (status !== 'all') { // Default: only non-deleted if status is not 'all' or 'deleted'
            initialMatch.deleted = { $ne: true };
        }
        // Other direct product filters
        if (otherFilters.userId) initialMatch.userId = new Types.ObjectId(otherFilters.userId as string);
        if (otherFilters.category) initialMatch.category = { $regex: otherFilters.category, $options: 'i' };
        if (otherFilters.subcategory) initialMatch.subcategory = { $regex: otherFilters.subcategory, $options: 'i' };
        if (priceMin !== undefined || priceMax !== undefined) {
            initialMatch.price = {};
            if (priceMin !== undefined) initialMatch.price.$gte = priceMin;
            if (priceMax !== undefined) initialMatch.price.$lte = priceMax;
        }
        if (otherFilters.searchTerm) {
            const regex = { $regex: otherFilters.searchTerm, $options: 'i' };
            initialMatch.$or = [
                { name: regex }, { description: regex }, { category: regex }, { subcategory: regex }
            ];
        }


        // Add the initial match stage if it has criteria
        if (Object.keys(initialMatch).length > 0) {
            pipeline.push({ $match: initialMatch });
        }

        // --- Lookup Active Flash Sales --- 
        pipeline.push({
            $lookup: {
                from: FlashSaleModel.collection.name, // Use collection name from model
                let: { productId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$productId', '$$productId'] },
                            status: FlashSaleStatus.ACTIVE,
                            startTime: { $lte: now },
                            endTime: { $gt: now }
                        }
                    },
                    { $limit: 1 }, // Only need to know if at least one exists
                    { $project: { _id: 1 } } // Only need existence check
                ],
                as: 'activeFlashSales'
            }
        });

        // --- Add hasActiveFlashSale Field --- 
        pipeline.push({
            $addFields: {
                hasActiveFlashSale: { $gt: [{ $size: '$activeFlashSales' }, 0] }
            }
        });

        // --- Match Based on hasActiveFlashSale Filter Input ---
        if (hasActiveFlashSale !== undefined && hasActiveFlashSale !== null && hasActiveFlashSale !== 'all') {
            // Convert string 'true'/'false' from query param to boolean
            const filterValue = typeof hasActiveFlashSale === 'string'
                ? hasActiveFlashSale.toLowerCase() === 'true'
                : Boolean(hasActiveFlashSale);
            pipeline.push({
                $match: { hasActiveFlashSale: filterValue }
            });
        }

        // --- Count Stage (for total count before pagination) --- 
        const countPipeline = [...pipeline]; // Clone pipeline before adding sort/skip/limit
        countPipeline.push({ $count: 'totalCount' });

        // --- Sort Stage ---
        const sortCriteria: { [key: string]: 1 | -1 } = {};
        sortCriteria[sortBy] = sortOrder === 'asc' ? 1 : -1;
        pipeline.push({ $sort: sortCriteria });

        // --- Skip and Limit Stages (Pagination) ---
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });

        // --- Final Projection (Optional - remove intermediate fields) ---
        pipeline.push({
            $project: {
                activeFlashSales: 0 // Remove the temporary lookup array
            }
        });

        // --- Execute Aggregations --- 
        try {
            // Execute count aggregation
            const countResult = await ProductModel.aggregate(countPipeline).exec();
            const totalCount = countResult.length > 0 ? countResult[0].totalCount : 0;

            // Execute main data aggregation
            const products: IProduct[] = await ProductModel.aggregate(pipeline).exec();

            // --- Prepare Pagination Info --- 
            const totalPages = Math.ceil(totalCount / limit);
            const paginationInfo = {
                totalCount,
                totalPages,
                currentPage: page,
                limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            return { products, paginationInfo };

        } catch (error) {
            // Use your logger here if available
            console.error('Error executing product search aggregation (admin repository):', error);
            throw error; // Re-throw to be caught by service layer
        }
    }

    /**
     * Public search for products (usually only approved/active)
     * @param filters Search filters
     * @returns Paginated list of products
     */
    async searchProducts(filters: ProductSearchFilters): Promise<{ products: IProduct[]; paginationInfo: any }> {
        const {
            page = 1,
            limit = 10,
            sortBy = 'overallRating',
            sortOrder = 'desc',
            status,
            priceMin,
            priceMax,
            ...otherFilters
        } = filters;
        const skip = (page - 1) * limit;

        const query: FilterQuery<IProduct> = {
            deleted: { $ne: true }
        };

        // Apply other filters
        if (otherFilters.userId) {
            query.userId = otherFilters.userId;
        }
        if (otherFilters.category) {
            query.category = { $regex: otherFilters.category, $options: 'i' };
        }
        if (otherFilters.subcategory) {
            query.subcategory = { $regex: otherFilters.subcategory, $options: 'i' };
        }
        if (status) {
            query.status = status;
        }
        if (priceMin !== undefined || priceMax !== undefined) {
            query.price = {};
            if (priceMin !== undefined) query.price.$gte = priceMin;
            if (priceMax !== undefined) query.price.$lte = priceMax;
        }
        if (otherFilters.searchTerm) {
            const regex = { $regex: otherFilters.searchTerm, $options: 'i' };
            query.$or = [
                { name: regex },
                { description: regex },
                { category: regex },
                { subcategory: regex }
            ];
        }

        const sortCriteria: { [key: string]: 1 | -1 } = {};
        sortCriteria[sortBy] = sortOrder === 'asc' ? 1 : -1;

        console.log(query)

        try {
            const totalCount = await ProductModel.countDocuments(query).exec();
            const products = await ProductModel.find(query)
                .sort(sortCriteria)
                .skip(skip)
                .limit(limit)
                // .populate('userId', 'name')
                .lean()
                .exec();

            const totalPages = Math.ceil(totalCount / limit);
            const paginationInfo = {
                totalCount,
                totalPages,
                currentPage: page,
                limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            };

            return { products, paginationInfo };
        } catch (error) {
            console.error('Error searching products (public repository):', error);
            throw error;
        }
    }
}

// Export an instance for easy use
export const productRepository = new ProductRepository(); 