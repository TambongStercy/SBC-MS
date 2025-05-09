import { Schema, Document, model, Types } from 'mongoose';
import { SubscriptionType } from './subscription.model'; // Assuming SubscriptionType is in subscription.model.ts

export enum PartnerTransactionType {
    DEPOSIT = 'deposit',
    WITHDRAWAL = 'withdrawal'
}

export interface IPartnerTransaction extends Document {
    partnerId: Types.ObjectId; // Ref to 'Partner'
    user: Types.ObjectId;      // Ref to 'User' (who is the partner)
    pack: 'silver' | 'gold';   // Pack at the time of transaction
    transType: PartnerTransactionType;
    message: string;
    amount: number;            // The commission amount for this partner
    sourcePaymentSessionId?: string;
    sourceSubscriptionType?: SubscriptionType;
    referralLevelInvolved?: 1 | 2 | 3; // Which referral position triggered this partner commission
    createdAt?: Date;
    updatedAt?: Date;
}

const PartnerTransactionSchema = new Schema<IPartnerTransaction>(
    {
        partnerId: {
            type: Schema.Types.ObjectId,
            ref: 'Partner',
            required: true,
            index: true,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        pack: {
            type: String,
            enum: ['silver', 'gold'],
            required: true,
        },
        transType: {
            type: String,
            enum: ['deposit', 'withdrawal'],
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        sourcePaymentSessionId: {
            type: String,
            required: false,
        },
        sourceSubscriptionType: {
            type: String,
            enum: Object.values(SubscriptionType),
            required: false,
        },
        referralLevelInvolved: {
            type: Number,
            enum: [1, 2, 3],
            required: false,
        },
    },
    {
        timestamps: true,
    }
);

const PartnerTransactionModel = model<IPartnerTransaction>('PartnerTransaction', PartnerTransactionSchema);

export default PartnerTransactionModel; 