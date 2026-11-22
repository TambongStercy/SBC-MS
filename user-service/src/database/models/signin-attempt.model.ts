import { Schema, Types, model } from 'mongoose';

/**
 * Security plan Phase 1 (item 3: "login and signup attempts are recorded too,
 * success or not"): one document per sign-in step. Kept 180 days (TTL). The
 * typed email or number is kept masked only, plus an HMAC to group attempts on
 * the same identifier (credential stuffing): the person may not be a member.
 */
export type SigninStep = 'password' | 'code';
export type SigninOutcome = 'code_sent' | 'signed_in' | 'unknown_account' | 'wrong_password' | 'blocked' | 'invalid' | 'wrong_code' | 'error';
export const SIGNIN_FAILURES: SigninOutcome[] = ['unknown_account', 'wrong_password', 'blocked', 'invalid', 'wrong_code', 'error'];

export interface ISigninAttempt {
    _id: Types.ObjectId;
    day: string; // Douala day
    at: Date;
    country: string; // Cloudflare's, else 'XX'
    source: 'web' | 'app' | 'api';
    step: SigninStep;
    outcome: SigninOutcome;
    userId?: Types.ObjectId | null;
    identifierMasked?: string | null;
    identifierKey?: string | null;
    requestId?: string | null;
    expiresAt: Date;
}

const SigninAttemptSchema = new Schema<ISigninAttempt>({
    day: { type: String, required: true },
    at: { type: Date, required: true },
    country: { type: String, required: true },
    source: { type: String, enum: ['web', 'app', 'api'], required: true },
    step: { type: String, enum: ['password', 'code'], required: true },
    outcome: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, default: null },
    identifierMasked: { type: String, default: null },
    identifierKey: { type: String, default: null },
    requestId: { type: String, default: null },
    expiresAt: { type: Date, required: true },
}, { collection: 'signin_attempts', versionKey: false });

SigninAttemptSchema.index({ day: 1, country: 1 });
SigninAttemptSchema.index({ userId: 1, at: -1 }, { partialFilterExpression: { userId: { $type: 'objectId' } } });
SigninAttemptSchema.index({ identifierKey: 1, at: -1 }, { partialFilterExpression: { identifierKey: { $type: 'string' } } });
SigninAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SigninAttemptModel = model<ISigninAttempt>('SigninAttempt', SigninAttemptSchema);
