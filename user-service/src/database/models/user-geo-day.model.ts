import { Document, Schema, Types, model } from 'mongoose';

/**
 * Security plan Phase 1 (signals): one document per member, country and day
 * (Africa/Douala calendar day). Written in batches from the gateway, only for
 * members who accepted the privacy policy that announces it. Deleted after
 * 180 days by the TTL index on `expiresAt`.
 */
export interface IUserGeoDay extends Document {
    userId: Types.ObjectId;
    day: string; // YYYY-MM-DD, Douala
    country: string; // ISO-3166 alpha-2 from Cloudflare, 'XX' when unknown
    requests: number;
    logins: number;
    /** Network operators (Cloudflare ASN), at most 5. */
    asns: number[];
    /** /24 (IPv4) or /48 (IPv6) ranges, at most 5. Never a full address. */
    ipRanges: string[];
    /** Device IDs sent by the apps (X-SBC-Device), at most 5. */
    devices: string[];
    /** Requests per source. */
    sources: { web: number; app: number; api: number };
    /** Authenticated calls that came without a device ID (itself a signal). */
    noDevice: number;
    firstAt: Date;
    lastAt: Date;
    expiresAt: Date;
}

const UserGeoDaySchema = new Schema<IUserGeoDay>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true },
    country: { type: String, required: true },
    requests: { type: Number, default: 0 },
    logins: { type: Number, default: 0 },
    asns: { type: [Number], default: [] },
    ipRanges: { type: [String], default: [] },
    devices: { type: [String], default: [] },
    sources: {
        web: { type: Number, default: 0 },
        app: { type: Number, default: 0 },
        api: { type: Number, default: 0 },
    },
    noDevice: { type: Number, default: 0 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
}, { collection: 'user_geo_days', versionKey: false });

UserGeoDaySchema.index({ userId: 1, day: 1, country: 1 }, { unique: true });
UserGeoDaySchema.index({ day: 1, country: 1 });
UserGeoDaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserGeoDayModel = model<IUserGeoDay>('UserGeoDay', UserGeoDaySchema);
