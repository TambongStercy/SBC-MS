import { Document, Schema, model } from 'mongoose';

/**
 * Security plan Phase 11: the daily activity figures, one document per Douala
 * day and country. Computed by jobs/activity-rollup.job (never by a dashboard
 * while it loads). Derived data: it can be rebuilt from signup_attempts,
 * user_geo_days, subscriptions and payment-service at any time.
 */
export interface ISignupCounts {
    started: number;
    completed: number;
    failed: number;
    inProgress: number;
    reasons: Record<string, number>;
}

export interface IActivityDay extends Document {
    day: string;
    country: string;
    signups: { web: ISignupCounts; app: ISignupCounts; api: ISignupCounts };
    connected: { all: number; web: number; app: number; api: number; exact: boolean };
    activated: number;
    payments: { failed: number; waiting: number; abandoned: number; groups: { sbc_code: number; provider_api: number; member: number; unknown: number } };
    updatedAt: Date;
}

const ActivityDaySchema = new Schema<IActivityDay>({
    day: { type: String, required: true },
    country: { type: String, required: true },
    signups: { type: Schema.Types.Mixed, default: undefined },
    connected: { type: Schema.Types.Mixed, default: undefined },
    activated: { type: Number, default: 0 },
    payments: { type: Schema.Types.Mixed, default: undefined },
    updatedAt: { type: Date, default: () => new Date() },
}, { collection: 'activity_days', versionKey: false });

ActivityDaySchema.index({ day: 1, country: 1 }, { unique: true });

export const ActivityDayModel = model<IActivityDay>('ActivityDay', ActivityDaySchema);
