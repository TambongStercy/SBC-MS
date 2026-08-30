import mongoose, { Schema, Document, Types } from 'mongoose';
import { Intention, ProfileStatus } from '../../types/sbclove.enums';

// Sub-document for a profile photo. The original is access-controlled; the
// blurred variant is served to members without an approved profile (spec §6).
export interface IProfilePhoto {
    fileId: string;          // settings-service file id (original)
    blurredFileId?: string;  // settings-service file id (blurred derivative)
    order: number;           // display order (0-based)
}

// Interface defining the LoveProfile document structure.
export interface ILoveProfile extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;          // Reference to the User (user-service) — source of truth
    displayName?: string;            // Optional pseudo; defaults to User.name when absent
    intention: Intention;
    otherIntentionText?: string;     // Only when intention === OTHER (spec §5)
    description: string;             // <= configured max length, content-restricted (spec §7)
    // Denormalised copy of User.sex. Identity data lives in user-service (spec
    // §5) and is hydrated at read time, but browsing MUST only ever propose the
    // opposite sex — and that has to be a database filter, or a page of 20 would
    // come back half empty after filtering in memory. Written from user-service
    // on create and refreshed on every profile update.
    sex?: string;
    photos: IProfilePhoto[];         // 1-3 photos (spec §4)
    status: ProfileStatus;
    moderation: {
        validatedBy?: Types.ObjectId;
        validatedAt?: Date;
        rejectionReason?: string;
        reportCount: number;         // distinct reports; drives auto-suspension (spec §14)
        suspendedAt?: Date;
    };
    createdAt: Date;
    updatedAt: Date;
}

const ProfilePhotoSchema = new Schema<IProfilePhoto>(
    {
        fileId: { type: String, required: true },
        blurredFileId: { type: String },
        order: { type: Number, required: true, default: 0 },
    },
    { _id: false }
);

const LoveProfileSchema = new Schema<ILoveProfile>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            unique: true, // one SBCLOVE profile per user
            index: true,
        },
        displayName: {
            type: String,
            trim: true,
        },
        intention: {
            type: String,
            enum: Object.values(Intention),
            required: true,
        },
        otherIntentionText: {
            type: String,
            trim: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        // No index of its own: every query that filters on sex also filters on
        // status, and the compound index below covers that pair.
        sex: {
            type: String,
        },
        photos: {
            type: [ProfilePhotoSchema],
            default: [],
        },
        status: {
            type: String,
            enum: Object.values(ProfileStatus),
            required: true,
            default: ProfileStatus.PENDING,
            index: true,
        },
        moderation: {
            validatedBy: { type: Schema.Types.ObjectId },
            validatedAt: { type: Date },
            rejectionReason: { type: String },
            reportCount: { type: Number, required: true, default: 0 },
            suspendedAt: { type: Date },
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
    }
);

// The browse query (status + sex, newest first) is the module's hot path: every
// member hits it repeatedly inside the 3-hour session. This compound index
// serves the filter AND the sort, so the deck is an index walk of `limit`
// documents rather than a sort of every approved profile.
// `_id` closes the index over the default sort, so paging stays an index walk
// even though the sort now carries a tiebreaker (see the repository's find()).
LoveProfileSchema.index({ status: 1, sex: 1, createdAt: -1, _id: -1 });

const LoveProfileModel = mongoose.model<ILoveProfile>('LoveProfile', LoveProfileSchema);

export default LoveProfileModel;
