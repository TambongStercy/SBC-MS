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

const LoveProfileModel = mongoose.model<ILoveProfile>('LoveProfile', LoveProfileSchema);

export default LoveProfileModel;
