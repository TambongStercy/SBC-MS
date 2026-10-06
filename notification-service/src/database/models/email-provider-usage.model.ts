import mongoose, { Schema } from 'mongoose';

/**
 * Emails sent through a paid provider, per calendar month (UTC):
 * `_id` is `<provider>:<YYYY-MM>`, e.g. `cloudflare:2026-10`. It is what the
 * monthly cap counts against, and the number to compare with the provider's bill.
 */
export interface IEmailProviderUsage {
    _id: string;
    count: number;
}

const EmailProviderUsageSchema = new Schema<IEmailProviderUsage>(
    { _id: { type: String, required: true }, count: { type: Number, required: true, default: 0 } },
    { versionKey: false, timestamps: { createdAt: false, updatedAt: true } },
);

export default mongoose.model<IEmailProviderUsage>('EmailProviderUsage', EmailProviderUsageSchema);
