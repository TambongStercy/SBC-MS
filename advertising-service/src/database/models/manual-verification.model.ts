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

/**
 * Who took a decision on a proof. `admin` = the admin panel (reviewedBy holds
 * the admin's user id); `support` = an agent in SBC Support, whose id lives in
 * support-service, not in users.
 */
export interface IDecisionActor {
    source: 'admin' | 'support';
    /** Admin user id, or the support agent id. */
    id?: string;
    name?: string;
    role?: string;
    /** A super admin deciding while the admin panel is read-only. */
    override?: boolean;
    requestId?: string;
}

export interface IManualVerificationEvent {
    at: Date;
    action: 'submitted' | 'approved' | 'rejected' | 'decision_reverted';
    by?: IDecisionActor;
    observedViewCount?: number;
    reason?: string;
    ban?: boolean;
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
    /**
     * When the recording was removed from storage after review.
     *
     * Set instead of clearing reviewedAt so the record still proves a review
     * happened — only the video itself goes. videoFileId is cleared alongside,
     * which is what tells the admin UI there is nothing left to play.
     */
    videoDeletedAt?: Date;
    /** Views the admin read off the video; what the day is credited on. */
    observedViewCount?: number;
    rejectionReason?: string;
    /** Who approved or rejected it (admin panel or SBC Support agent). */
    decidedBy?: IDecisionActor;
    /** Submission and decisions, oldest first. */
    history?: IManualVerificationEvent[];
    createdAt: Date;
    updatedAt: Date;
}

const DecisionActorSchema = new Schema<IDecisionActor>({
    source: { type: String, enum: ['admin', 'support'], required: true },
    id: String,
    name: String,
    role: String,
    override: Boolean,
    requestId: String,
}, { _id: false });

const EventSchema = new Schema<IManualVerificationEvent>({
    at: { type: Date, required: true },
    action: { type: String, required: true },
    by: { type: DecisionActorSchema, default: undefined },
    observedViewCount: Number,
    reason: String,
    ban: Boolean,
}, { _id: false });

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
    videoDeletedAt: { type: Date },
    observedViewCount: { type: Number, min: 0 },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    decidedBy: { type: DecisionActorSchema, default: undefined },
    history: { type: [EventSchema], default: undefined },
}, { timestamps: true });

// The review queue's hot query: oldest pending first.
ManualVerificationSchema.index({ status: 1, createdAt: 1 });
// SBC Support's catch-up sync: what changed since its last pass.
ManualVerificationSchema.index({ status: 1, updatedAt: 1 });

const ManualVerificationModel = mongoose.model<IManualVerification>('ManualVerification', ManualVerificationSchema);
export default ManualVerificationModel;
