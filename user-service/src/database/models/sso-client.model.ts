import { Schema, Document, model } from 'mongoose';

/**
 * A registered third-party application allowed to authenticate users via SBC SSO.
 *
 * Created and managed out-of-band (one-off script or admin tool) — there is no
 * self-service client registration. Each client gets a unique `clientId` (used in
 * the authorize redirect) and a `clientSecret` (hashed at rest, used only by the
 * client's backend to exchange auth codes for tokens).
 *
 * Initial client: SBC Live (live.sniperbuisnesscenter.com). Future: anything Rufus
 * approves.
 */
export interface ISsoClient extends Document {
    clientId: string;
    clientSecretHash: string;
    name: string;
    /** Whitelist of redirect URIs the authorize endpoint will accept for this client. */
    redirectUris: string[];
    /** Whitelist of scopes this client is allowed to request. */
    allowedScopes: string[];
    /** Soft-disable a client without deleting it (e.g. credentials rotated, leak suspected). */
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const SsoClientSchema = new Schema<ISsoClient>(
    {
        clientId: { type: String, required: true, unique: true, index: true },
        clientSecretHash: { type: String, required: true, select: false },
        name: { type: String, required: true },
        redirectUris: { type: [String], required: true, default: [] },
        allowedScopes: { type: [String], required: true, default: ['profile.read'] },
        enabled: { type: Boolean, required: true, default: true, index: true },
    },
    { timestamps: true },
);

export const SsoClient = model<ISsoClient>('SsoClient', SsoClientSchema);
export default SsoClient;
