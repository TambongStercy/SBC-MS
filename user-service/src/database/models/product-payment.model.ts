import { Schema, model, Document, Types } from 'mongoose';

/**
 * One row per payment of a product sold beside CLASSIQUE/CIBLE (Pack Winner,
 * PRO, MISE_EN_AVANT, extra numbers). Written before the product is applied:
 * the unique sessionId means a repeated payment callback applies it once.
 * Monthly products extend from the current end date, so a second delivery
 * would otherwise give a free month.
 */
export interface IProductPayment extends Document {
    sessionId: string;
    userId: Types.ObjectId;
    product: 'WINNER' | 'ADDON' | 'EXTRA_NUMBER';
    offerId?: string;
    createdAt: Date;
}

const schema = new Schema<IProductPayment>({
    sessionId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    product: { type: String, required: true },
    offerId: String,
}, { timestamps: true });

export default model<IProductPayment>('ProductPayment', schema);
