import { Schema, Document, Types, model } from 'mongoose';

/**
 * Short-lived authorization code issued during the SSO grant flow.
 *
 * Lifecycle:
 *   1. SBC's frontend calls `POST /api/sso/grant-code` after the user clicks
 *      "Authorize" on the consent screen. Backend creates a code document.
 *   2. Frontend redirects browser to `redirect_uri?code=<code>&state=<state>`.
 *   3. Client's backend calls `POST /api/sso/token` with the code + client_secret.
 *      Backend marks code as used (one-shot) and returns access + refresh tokens.
 *
 * The code itself is a high-entropy random string, not a JWT. Codes expire after
 * `expiresAt` and are rejected if `used: true` (replay prevention).
 *
 * TTL index: documents auto-delete shortly after expiresAt to keep the collection
 * from accumulating spent codes forever.
 */
export interface ISsoAuthCode extends Document {
    code: string;
    userId: Types.ObjectId;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: Date;
    used: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const SsoAuthCodeSchema = new Schema<ISsoAuthCode>(
    {
        code: { type: String, required: true, unique: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        clientId: { type: String, required: true, index: true },
        redirectUri: { type: String, required: true },
        scopes: { type: [String], required: true, default: [] },
        expiresAt: { type: Date, required: true },
        used: { type: Boolean, required: true, default: false },
    },
    { timestamps: true },
);

// Auto-delete codes 1 hour after expiry. Spent codes don't accumulate.
SsoAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const SsoAuthCode = model<ISsoAuthCode>('SsoAuthCode', SsoAuthCodeSchema);
export default SsoAuthCode;
