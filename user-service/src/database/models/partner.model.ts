import { Schema, Document, model, Types } from 'mongoose';

export interface IPartner extends Document {
    user: Types.ObjectId; // Ref to 'User'
    pack: 'silver' | 'gold';
    isActive: boolean;
    amount: number; // Partner's commission balance specific to partner activities
    createdAt?: Date;
    updatedAt?: Date;
}

const PartnerSchema = new Schema<IPartner>(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        pack: {
            type: String,
            enum: ['silver', 'gold'],
            required: true,
            lowercase: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        amount: {
            type: Number,
            default: 0,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

const PartnerModel = model<IPartner>('Partner', PartnerSchema);

export default PartnerModel; 