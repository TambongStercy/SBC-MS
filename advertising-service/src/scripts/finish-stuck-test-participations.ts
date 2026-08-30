/**
 * Finish test-campaign participations left mid-flight by the 3-day -> 1-day change.
 *
 * The 1-day test campaign only affects NEWLY offered participations (the days
 * array is built at offer time). Diffuseurs who were already mid-test still carry
 * a 3-day array, so verifying day 1 no longer completes them and they never
 * become eligible for paid work. This truncates such a participation to its
 * verified day 1 and runs it through the normal completion path (which fires the
 * ranking side-effects, including hasCompletedTestCampaign).
 *
 * Targets ONLY: isTestCampaign participations, IN_PROGRESS, with day 1 VERIFIED
 * and at least one later day. Real campaigns and single-day participations are
 * untouched. Idempotent.
 *
 * Usage (on the server, in advertising-service/):
 *   npx ts-node src/scripts/finish-stuck-test-participations.ts          # dry run
 *   npx ts-node src/scripts/finish-stuck-test-participations.ts --apply  # execute
 */

import mongoose from 'mongoose';
import config from '../config';
import CampaignModel from '../database/models/campaign.model';
import CampaignParticipationModel, { DayStatus, ParticipationStatus } from '../database/models/campaign-participation.model';
import { markDayVerifiedManually } from '../services/verification.service';

const APPLY = process.argv.includes('--apply');

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log(APPLY ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to execute) ---');

    const testCampaignIds = (await CampaignModel.find({ isTestCampaign: true }).select('_id').lean()).map(c => c._id);
    if (!testCampaignIds.length) { console.log('No test campaigns found.'); await mongoose.disconnect(); return; }

    const candidates = await CampaignParticipationModel.find({
        campaignId: { $in: testCampaignIds },
        status: ParticipationStatus.IN_PROGRESS,
    });

    let matched = 0, done = 0, skipped = 0, failed = 0;

    for (const p of candidates) {
        const day1 = p.days.find(d => d.day === 1);
        const hasLaterDays = p.days.some(d => d.day > 1);
        // Only the ones the 1-day change would now complete: day 1 done, but a
        // stale later day is still holding them open.
        if (!day1 || day1.status !== DayStatus.VERIFIED || !hasLaterDays) { skipped++; continue; }
        matched++;

        const tag = `${p._id} | diffuseur ${p.diffuseurUserId} | day1 ${day1.viewCount} views`;
        if (!APPLY) { console.log(`WOULD FINISH: ${tag}`); continue; }

        try {
            // Drop the stale later days, then run day 1 through the normal
            // completion path (recompute -> COMPLETED -> ranking side-effects).
            p.days = [day1] as any;
            await p.save();
            const res = await markDayVerifiedManually(p._id, 1, day1.viewCount);
            console.log(`OK ${res.justCompleted ? 'COMPLETED' : 'updated (not yet matured)'}: ${tag}`);
            done++;
        } catch (err: any) {
            console.log(`FAIL ${tag}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\nSummary: matched ${matched}, ${APPLY ? `finished ${done}` : 'would finish (see above)'}, skipped ${skipped}, failed ${failed}.`);
    await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
