import { Schema, model, Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import { MemberAuthModel } from '../database/models/member-auth.model';
import { doualaDay } from './activity-signals.service';
import logger from '../utils/logger';

const log = logger.getLogger('AuthenticatorAdoption');

/**
 * Security plan Phase 3, rollout (plan item 5): "before the mandatory date, the
 * share of members with a balance above 5,000 XAF who set it up is reported
 * daily". One snapshot per Douala day in `authenticator_adoption_days`.
 */
export const ADOPTION_MIN_BALANCE = 5_000;

const DaySchema = new Schema({
    _id: String, // Douala day
    withBalance: Number,
    enrolledWithBalance: Number,
    share: Number, // 0..1
    enrolledTotal: Number,
    at: Date,
}, { collection: 'authenticator_adoption_days', versionKey: false });
export const AuthenticatorAdoptionDayModel = model('AuthenticatorAdoptionDay', DaySchema);

export async function computeAdoption(now: Date = new Date()) {
    const enrolled = new Set((await MemberAuthModel.find({ totpSecretEnc: { $ne: null } }, { userId: 1 }).lean()).map((a: any) => String(a.userId)));
    let withBalance = 0;
    let enrolledWithBalance = 0;
    const cursor = UserModel.find({ balance: { $gt: ADOPTION_MIN_BALANCE }, deleted: { $ne: true }, blocked: { $ne: true } }, { _id: 1 }).lean().cursor({ batchSize: 5000 });
    for await (const u of cursor as any) {
        withBalance++;
        if (enrolled.has(String(u._id as Types.ObjectId))) enrolledWithBalance++;
    }
    const row = {
        _id: doualaDay(now), withBalance, enrolledWithBalance,
        share: withBalance ? Math.round((enrolledWithBalance / withBalance) * 10_000) / 10_000 : 0,
        enrolledTotal: enrolled.size, at: now,
    };
    await AuthenticatorAdoptionDayModel.updateOne({ _id: row._id }, { $set: row }, { upsert: true });
    log.info(`Authenticator adoption ${row._id}: ${enrolledWithBalance}/${withBalance} members above ${ADOPTION_MIN_BALANCE} F (${(row.share * 100).toFixed(1)} %), ${enrolled.size} set up in all`);
    return row;
}

/** For the admin: the last `days` snapshots, oldest first. */
export async function adoptionHistory(days = 30) {
    const rows = await AuthenticatorAdoptionDayModel.find({}).sort({ _id: -1 }).limit(Math.min(Math.max(days, 1), 365)).lean();
    return { minBalance: ADOPTION_MIN_BALANCE, days: rows.reverse() };
}
