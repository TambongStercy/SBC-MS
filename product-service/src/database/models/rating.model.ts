import { Schema, Document, Types, model, Query } from 'mongoose';

// Interface defining the Rating document structure
export interface IRating extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId; // Reference to the user who rated
    productId: Types.ObjectId; // Reference to the product being rated
    rating: number; // Rating value (1-5)
    review?: string; // Optional review text
    helpful: number; // Count of users who found this review helpful
    helpfulVotes?: Types.ObjectId[]; // <-- Add array to store user IDs
    deleted: boolean;
    deletedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const RatingSchema = new Schema<IRating>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
            index: true
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        review: {
            type: String,
            trim: true
        },
        helpful: {
            type: Number,
            default: 0,
            min: 0
        },
        helpfulVotes: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
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
        timestamps: true,
    }
);

RatingSchema.index({ userId: 1, productId: 1 }, { unique: true });

// --- Soft Delete Query Middleware ---
// Filter out soft-deleted documents for find operations
RatingSchema.pre('find', function (this: Query<any, IRating>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

RatingSchema.pre('findOne', function (this: Query<any, IRating>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

RatingSchema.pre('countDocuments', function (this: Query<any, IRating>, next: (err?: Error) => void) {
    const conditions = this.getFilter();
    if (!(conditions.deleted === true || conditions.deleted?.$eq === true)) {
        this.where({ deleted: { $ne: true } });
    }
    next();
});

const RatingModel = model<IRating>('Rating', RatingSchema);

export default RatingModel; 