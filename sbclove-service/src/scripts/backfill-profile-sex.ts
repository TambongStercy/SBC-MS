/**
 * Backfill `LoveProfile.sex` from user-service.
 *
 * Browsing filters on the denormalised copy (opposite sex only), so a profile
 * created before that field existed would never be proposed to anyone. Run once
 * after deploying it; safe to re-run — it only touches profiles missing the copy.
 *
 * Run: npx ts-node src/scripts/backfill-profile-sex.ts
 */
import connectDB from '../database/connection';
import mongoose from 'mongoose';
import LoveProfileModel from '../database/models/love-profile.model';
import { userServiceClient } from '../services/clients/user.service.client';

const BATCH = 100;

async function main() {
    await connectDB();

    const profiles = await LoveProfileModel.find({ sex: { $in: [null, undefined, ''] } }).select('_id userId').lean().exec();
    if (profiles.length === 0) {
        console.log('nothing to backfill');
        return;
    }
    console.log(`${profiles.length} profile(s) without a sex copy`);

    let filled = 0;
    for (let i = 0; i < profiles.length; i += BATCH) {
        const slice = profiles.slice(i, i + BATCH);
        const users = await userServiceClient.getUsersByIds(slice.map(p => p.userId.toString()));
        const sexById = new Map(users.map(u => [u._id.toString(), u.sex]));

        for (const p of slice) {
            const sex = sexById.get(p.userId.toString());
            if (!sex) continue; // user-service has no sex for them; nothing to copy
            await LoveProfileModel.updateOne({ _id: p._id }, { $set: { sex } });
            filled++;
        }
        console.log(`  ${Math.min(i + BATCH, profiles.length)}/${profiles.length}`);
    }

    console.log(`backfilled ${filled} profile(s); ${profiles.length - filled} had no sex on their SBC account`);
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
