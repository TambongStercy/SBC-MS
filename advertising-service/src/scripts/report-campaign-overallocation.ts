/**
 * Show how much reach each live campaign has booked against what was paid for.
 *
 * Rufus, 2026-09-04, on a campaign bought at 2000 unique views: « il y a plus de
 * 2517 vues uniques, qu'on doit payer forcément ». Allocation only counted views
 * already VERIFIED, so for the first 24h of a campaign — before anyone has posted
 * — every scheduler tick saw the target untouched and staffed it again from
 * scratch. Offers now reserve the reach they forecast, and this reports what each
 * campaign currently holds so an existing overshoot is visible rather than
 * inferred.
 *
 * Read-only by default. --apply withdraws the offers that are surplus to the
 * target on campaigns whose accepted diffuseurs already cover it; it never touches
 * anyone who has accepted, because they agreed to post and will be paid for it.
 *
 * Usage (on the server, in advertising-service/):
 *   npx ts-node src/scripts/report-campaign-overallocation.ts
 *   npx ts-node src/scripts/report-campaign-overallocation.ts --apply
 */

import mongoose from 'mongoose';
import config from '../config';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import { expireStaleOffers, remainingViewsToCover } from '../services/allocation.service';

const APPLY = process.argv.includes('--apply');

const run = async () => {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log(`Connected to ${config.mongodb.uri}\n`);

    // COMPLETED too: a campaign that closed over target is exactly the complaint,
    // and its offers can still be sitting there waiting to be accepted.
    const campaigns = await CampaignModel.find({
        isTestCampaign: { $ne: true },
        status: { $in: [CampaignStatus.ACTIVE, CampaignStatus.COMPLETED] },
    }).sort({ activatedAt: -1 });

    let overshooting = 0;
    let withdrawn = 0;

    for (const campaign of campaigns) {
        const counts = await CampaignParticipationModel.aggregate<{ _id: string; n: number }>([
            { $match: { campaignId: campaign._id } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
        ]);
        const by = new Map(counts.map(c => [c._id, c.n]));

        const booked = await remainingViewsToCover(campaign as ICampaign);
        const accepted = await remainingViewsToCover(campaign as ICampaign, { acceptedOnly: true });
        const over = campaign.uniqueViewsDelivered - campaign.targetUniqueViews;

        const flag = over > 0 ? `  ⚠ ${over} views over` : '';
        console.log(
            `${campaign.status.padEnd(9)} ${String(campaign.title).slice(0, 40).padEnd(40)} `
            + `${campaign.uniqueViewsDelivered}/${campaign.targetUniqueViews} delivered  `
            + `still uncovered: ${booked} (accepted only: ${accepted})  `
            + `offered ${by.get(ParticipationStatus.OFFERED) ?? 0} / `
            + `in progress ${by.get(ParticipationStatus.IN_PROGRESS) ?? 0} / `
            + `done ${by.get(ParticipationStatus.COMPLETED) ?? 0}${flag}`,
        );

        if (over > 0) overshooting++;

        if (APPLY && accepted <= 0) {
            const expired = await expireStaleOffers(campaign._id);
            if (expired) {
                withdrawn += expired;
                console.log(`   withdrew ${expired} surplus offer(s)`);
            }
        }
    }

    console.log(
        `\n${campaigns.length} campaign(s), ${overshooting} past target.`
        + (APPLY ? ` Withdrew ${withdrawn} surplus offer(s).` : ' Read-only; pass --apply to withdraw surplus offers.'),
    );

    await mongoose.disconnect();
};

run().catch(async err => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
