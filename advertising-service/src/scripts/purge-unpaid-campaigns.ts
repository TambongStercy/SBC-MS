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
 *   - never validated (draft / pending_review) — APPROVED ones were validated and
 *     are only waiting to be paid, so they are never touched. Pass
 *     --include-rejected / --include-cancelled to widen it.
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

/**
 * Never validated: no admin has passed judgement on these.
 *
 * APPROVED is deliberately absent — those WERE validated, they are just waiting
 * on payment, and Rufus asked only for the ones that were neither validated nor
 * paid. REJECTED and CANCELLED already carry a decision, so they are opt-in.
 */
const NEVER_VALIDATED = [CampaignStatus.DRAFT, CampaignStatus.PENDING_REVIEW];

const statuses = [...NEVER_VALIDATED];
if (process.argv.includes('--include-rejected')) statuses.push(CampaignStatus.REJECTED);
if (process.argv.includes('--include-cancelled')) statuses.push(CampaignStatus.CANCELLED);

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log(APPLY ? '*** APPLY MODE — campaigns WILL be deleted ***' : '--- DRY RUN (pass --apply to delete) ---');

    const candidates = await CampaignModel.find({
        isTestCampaign: { $ne: true },
        status: { $in: statuses },
        paidAt: { $exists: false },
        paymentSessionId: { $exists: false },
        bankedAmount: { $in: [null, 0] },
    }).sort({ createdAt: 1 });

    console.log(`Statuses: ${statuses.join(', ')}`);
    console.log(`${candidates.length} campaign(s) never validated and never paid.\n`);

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
