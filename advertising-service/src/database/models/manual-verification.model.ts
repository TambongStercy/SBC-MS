import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Video-proof (manual) verification of a campaign day.
 *
 * The fallback for when the WhatsApp auto-connect fails: the diffuseur records
 * their screen showing a code we issue, then their WhatsApp status views, and
 * uploads the video. An admin watches it, confirms the code matches the one we
 * issued (proving the recording is fresh) and reads the view count, then
 * approves — which verifies the day through the same earnings path as auto.
 */
export enum ManualVerificationStatus {
    /** Code issued; waiting for the diffuseur to upload the recording in time. */
    AWAITING_UPLOAD = 'awaiting_upload',
    /** Video uploaded within the window; queued for an admin to review. */
    PENDING_REVIEW = 'pending_review',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    /** Code expired before a video arrived — the diffuseur must start again. */
    EXPIRED = 'expired',
}

export interface IManualVerification extends Document {
    _id: Types.ObjectId;
    participationId: Types.ObjectId;
    campaignId: Types.ObjectId;
    diffuseurUserId: Types.ObjectId;
    /** Which campaign day this proves. */
    day: number;
    /** The unpredictable code shown on screen; the admin confirms it in the video. */
    code: string;
    codeIssuedAt: Date;
    /** codeIssuedAt + manualVerifyWindowSeconds. Upload after this is refused. */
    expiresAt: Date;
    status: ManualVerificationStatus;
    /** settings-service file id of the uploaded screen recording. */
    videoFileId?: string;
    uploadedAt?: Date;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    /** Views the admin read off the video; what the day is credited on. */
    observedViewCount?: number;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ManualVerificationSchema = new Schema<IManualVerification>({
    participationId: { type: Schema.Types.ObjectId, ref: 'CampaignParticipation', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    diffuseurUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    day: { type: Number, required: true, min: 1 },
    code: { type: String, required: true },
    codeIssuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
        type: String,
        enum: Object.values(ManualVerificationStatus),
        default: ManualVerificationStatus.AWAITING_UPLOAD,
        index: true,
    },
    videoFileId: { type: String },
    uploadedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId },
    reviewedAt: { type: Date },
    observedViewCount: { type: Number, min: 0 },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true });

// The review queue's hot query: oldest pending first.
ManualVerificationSchema.index({ status: 1, createdAt: 1 });

const ManualVerificationModel = mongoose.model<IManualVerification>('ManualVerification', ManualVerificationSchema);
export default ManualVerificationModel;
