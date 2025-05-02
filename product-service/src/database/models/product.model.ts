import { Schema, Document, Types, model, Query } from 'mongoose';

// Define Product Status
export enum ProductStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected'
}

// Interface for a single image stored in the product
export interface IProductImage {
    url: string; // The proxied URL to access the image (e.g., /settings/files/fileId)
    fileId: string; // The original file ID from the settings service / Google Drive
}

// Interface defining the Product document structure
export interface IProduct extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId; // Reference to the user who created the product
    name: string;
    category: string;
    subcategory: string;
    description: string;
    images: IProductImage[]; // Array of image objects
    price: number;
    ratings: Types.ObjectId[]; // References to Rating documents
    overallRating: number;
    status: ProductStatus;
    rejectionReason?: string;
    deleted: boolean;
    deletedAt?: Date;
    hasActiveFlashSale?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>({
    url: { type: String, required: true },
    fileId: { type: String, required: true },
}, { _id: false });

const ProductSchema = new Schema<IProduct>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        category: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true
        },
        subcategory: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true
        },
        description: {
            type: String,
            required: true,
            trim: true
        },
        images: [ProductImageSchema], // Use the new schema
        price: {
            type: Number,
            required: true,
            min: 0
        },
        ratings: [{
            type: Schema.Types.ObjectId,
            ref: 'Rating'
        }],
        overallRating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        status: {
            type: String,
            enum: Object.values(ProductStatus),
            default: ProductStatus.APPROVED,
            index: true
        },
        rejectionReason: {
            type: String,
            trim: true
        },
        deleted: {
            type: Boolean,
            default: false,
            index: true
        },
        deletedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

// --- Soft Delete Query Middleware ---
// Filter out soft-deleted documents for find operations
ProductSchema.pre('find', function (this: Query<any, IProduct>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

ProductSchema.pre('findOne', function (this: Query<any, IProduct>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

ProductSchema.pre('countDocuments', function (this: Query<any, IProduct>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

ProductSchema.pre('findOneAndUpdate', function (this: Query<any, IProduct>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

ProductSchema.pre('updateMany', function (this: Query<any, IProduct>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

const ProductModel = model<IProduct>('Product', ProductSchema);

export default ProductModel; 