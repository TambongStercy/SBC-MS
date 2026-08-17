import mongoose, { Schema, Document, Types } from 'mongoose';

// A block relationship: blocker hides and is hidden from blocked (spec §14).
export interface IBlock extends Document {
    _id: Types.ObjectId;
    blockerId: Types.ObjectId;
    blockedUserId: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const BlockSchema = new Schema<IBlock>(
    {
        blockerId: { type: Schema.Types.ObjectId, required: true, index: true },
        blockedUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    },
    {
        timestamps: true,
    }
);

// A user can block another user only once.
BlockSchema.index({ blockerId: 1, blockedUserId: 1 }, { unique: true });

const BlockModel = mongoose.model<IBlock>('Block', BlockSchema);

export default BlockModel;
