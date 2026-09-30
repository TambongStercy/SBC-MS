/**
 * Cut test-campaign participations created under the old 3-day rule down to 1 day.
 *
 * The test campaign became 1 day in early September, but that only shaped NEW
 * offers. Anyone already inside one kept its three day slots, so they kept being
 * asked for days 2 and 3 — Rufus, 2026-09-15: « mets la campagne test à 1 jour »,
 * reporting users still living the 3-day version. Measured that day: 10 were
 * still in progress, and 2 of those had ALREADY verified day 1. Under the current
 * rule those two had finished and should have been offered paid campaigns.
 *
 * Only IN_PROGRESS participations of the test campaign are touched. Days 2 and 3
 * are removed and the completion deadline recomputed from the one day left. The
 * test campaign pays nothing (every day carries ratePerView 0), so no earnings are
 * lost by dropping days.
 *
 * Nothing is marked completed here. The scheduler's completeMaturedParticipations
 * already finishes any participation whose days are all verified once its last
 * status has expired, and it runs recordCompletion — which is what sets
 * hasCompletedTestCampaign and unlocks paid work. Doing it through that path means
 * these users are finished exactly the way everyone else is.
 *
 * Dry run by default.
 *
 * Usage (on the server, in advertising-service/):
 *   npx ts-node src/scripts/shorten-old-test-participations.ts
 *   npx ts-node src/scripts/shorten-old-test-participations.ts --apply
 */

import mongoose from 'mongoose';
import config from '../config';
import CampaignModel from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';

const APPLY = process.argv.includes('--apply');
const DAY_MS = 24 * 60 * 60 * 1000;

const run = async () => {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log(APPLY ? '*** APPLY ***\n' : '--- DRY RUN (pass --apply) ---\n');

    const testCampaigns = await CampaignModel.find({ isTestCampaign: true }).select('_id').lean();
    const keep = config.campaign.testDurationDays;

    const stale = await CampaignParticipationModel.find({
        campaignId: { $in: testCampaigns.map(c => c._id) },
        status: ParticipationStatus.IN_PROGRESS,
        [`days.${keep}`]: { $exists: true },
    });

    console.log(`${stale.length} in-progress test participation(s) longer than ${keep} day(s).\n`);

    let shortened = 0;
    for (const p of stale) {
        const before = p.days.map(d => `day${d.day}=${d.status}`).join(' ');
        p.days = p.days.filter(d => d.day <= keep);

        if (p.acceptedAt) {
            p.completionDeadline = new Date(
                p.acceptedAt.getTime() + (p.days.length + config.campaign.graceDays) * DAY_MS,
            );
        }

        const allVerified = p.days.every(d => d.status === 'verified');
        console.log(
            `${String(p.diffuseurUserId)}  ${before}  ->  ${p.days.map(d => `day${d.day}=${d.status}`).join(' ')}`
            + (allVerified ? '  (finished: the scheduler completes it next tick)' : ''),
        );

        if (APPLY) {
            await p.save();
            shortened++;
        }
    }

    console.log(`\n${APPLY ? `Shortened ${shortened}.` : 'Nothing written. Pass --apply to shorten them.'}`);
    await mongoose.disconnect();
};

run().catch(async err => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
