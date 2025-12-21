import { Schema, Document, Types, model } from 'mongoose';

export enum InteractionType {
    LIKE = 'like',
    REPOST = 'repost',
    VIEW = 'view'
}

export interface IStatusInteraction extends Document {
    _id: Types.ObjectId;
    statusId: Types.ObjectId;
    userId: Types.ObjectId;
    type: InteractionType;
    createdAt: Date;
}

const StatusInteractionSchema = new Schema<IStatusInteraction>(
    {
        statusId: {
            type: Schema.Types.ObjectId,
            ref: 'Status',
            required: true,
            index: true
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: Object.values(InteractionType),
            required: true
        }
    },
    { timestamps: true }
);

// Compound unique index to prevent duplicate likes/reposts (but allow multiple views)
StatusInteractionSchema.index(
    { statusId: 1, userId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { type: { $in: ['like', 'repost'] } }
    }
);

// Index for getting all interactions of a specific type
StatusInteractionSchema.index({ statusId: 1, type: 1 });

// Index for user's interactions
StatusInteractionSchema.index({ userId: 1, type: 1, createdAt: -1 });

export default model<IStatusInteraction>('StatusInteraction', StatusInteractionSchema);
