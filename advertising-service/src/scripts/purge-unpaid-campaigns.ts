/**
 * Delete the annonceur campaigns nobody ever paid for.
 *
 * Rufus, on switching to pay-first: « toutes les campagnes des annonceurs qui
 * étaient là avant supprime, les gars blaguaient seulement là-bas. » The old
 * order let anyone fill the moderation queue for free, and 260 of those were
 * sitting there the day pay-first shipped.
 *
 * Deletes ONLY campaigns that are all of:
 *   - not the test campaign
 *   - in a status that never ran (draft / pending_review / approved / rejected /
 *     cancelled)
 *   - unpaid on every signal (no paidAt, no paymentSessionId, no bankedAmount)
 *   - carrying no participations, so no diffuseur work is thrown away
 *
 * Anything active, paused, completed, banked or paid is untouched by
 * construction. The participation check is re-run per campaign at delete time,
 * not just in the summary, so a campaign that gained one meanwhile survives.
 *
 * Dry-run by default.
 *
 * Usage (on the server, in advertising-service/):
 *   npx ts-node src/scripts/purge-unpaid-campaigns.ts          # dry run
 *   npx ts-node src/scripts/purge-unpaid-campaigns.ts --apply  # delete
 */

import mongoose from 'mongoose';
import config from '../config';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel from '../database/models/campaign-participation.model';

const APPLY = process.argv.includes('--apply');

const NEVER_RAN = [
    CampaignStatus.DRAFT,
    CampaignStatus.PENDING_REVIEW,
    CampaignStatus.APPROVED,
    CampaignStatus.REJECTED,
    CampaignStatus.CANCELLED,
];

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log(APPLY ? '*** APPLY MODE — campaigns WILL be deleted ***' : '--- DRY RUN (pass --apply to delete) ---');

    const candidates = await CampaignModel.find({
        isTestCampaign: { $ne: true },
        status: { $in: NEVER_RAN },
        paidAt: { $exists: false },
        paymentSessionId: { $exists: false },
        bankedAmount: { $in: [null, 0] },
    }).sort({ createdAt: 1 });

    console.log(`${candidates.length} unpaid campaign(s) that never ran.\n`);

    let deleted = 0, kept = 0;

    for (const c of candidates) {
        // Re-checked per campaign: the summary count could be stale by now, and
        // deleting a campaign a diffuseur is working on would orphan their proof.
        const participations = await CampaignParticipationModel.countDocuments({ campaignId: c._id });
        const label = `${c._id} | ${c.status} | ${c.amountPaid} XAF | ${String(c.title).slice(0, 40)}`;

        if (participations > 0) {
            console.log(`KEEP (${participations} participation(s)): ${label}`);
            kept++;
            continue;
        }

        if (!APPLY) {
            console.log(`WOULD DELETE: ${label}`);
            continue;
        }

        await CampaignModel.deleteOne({ _id: c._id });
        deleted++;
    }

    console.log(
        APPLY
            ? `\nDeleted ${deleted} campaign(s); kept ${kept} with participations.`
            : `\nNothing changed. ${candidates.length - kept} would be deleted, ${kept} kept.`,
    );
    await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
