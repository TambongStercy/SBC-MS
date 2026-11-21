import { Document, Schema, Types, model } from 'mongoose';

/**
 * Security plan Phase 11: one document per sign-up form sent
 * (POST /users/register), whatever happened to it. Deleted after 180 days
 * (TTL on `expiresAt`). Contact details are kept masked only: the person may
 * never have become a member and gave no consent.
 */
export type SignupOutcome = 'in_progress' | 'completed' | 'failed';
export type SignupStep = 'form' | 'server' | 'code';
export type SignupSource = 'web' | 'app' | 'api';

export interface ISignupDelivery {
    channel: string;
    status: string;
    error?: string | null;
    at?: Date | null;
}

export interface ISignupAttempt extends Document {
    day: string; // Douala day the form was sent
    startedAt: Date;
    country: string; // declared (form) country, else Cloudflare's, else 'XX'
    geoCountry?: string | null;
    source: SignupSource;
    outcome: SignupOutcome;
    step: SignupStep;
    reason?: string | null;
    detail?: string | null;
    userId?: Types.ObjectId | null;
    emailMasked?: string | null;
    phoneMasked?: string | null;
    sponsorCode?: string | null;
    annonceur?: boolean;
    wrongCodes: number;
    delivery: ISignupDelivery[];
    requestId?: string | null;
    replayUrl?: string | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
    expiresAt: Date;
}

const SignupAttemptSchema = new Schema<ISignupAttempt>({
    day: { type: String, required: true },
    startedAt: { type: Date, required: true },
    country: { type: String, required: true },
    geoCountry: { type: String, default: null },
    source: { type: String, enum: ['web', 'app', 'api'], required: true },
    outcome: { type: String, enum: ['in_progress', 'completed', 'failed'], required: true },
    step: { type: String, enum: ['form', 'server', 'code'], required: true },
    reason: { type: String, default: null },
    detail: { type: String, default: null },
    userId: { type: Schema.Types.ObjectId, default: null },
    emailMasked: { type: String, default: null },
    phoneMasked: { type: String, default: null },
    sponsorCode: { type: String, default: null },
    annonceur: { type: Boolean, default: false },
    wrongCodes: { type: Number, default: 0 },
    delivery: { type: [{ _id: false, channel: String, status: String, error: String, at: Date }], default: [] },
    requestId: { type: String, default: null },
    replayUrl: { type: String, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
}, { collection: 'signup_attempts', versionKey: false });

SignupAttemptSchema.index({ day: 1, country: 1 });
SignupAttemptSchema.index({ userId: 1 }, { partialFilterExpression: { userId: { $type: 'objectId' } } });
SignupAttemptSchema.index({ outcome: 1, startedAt: 1 });
SignupAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SignupAttemptModel = model<ISignupAttempt>('SignupAttempt', SignupAttemptSchema);
