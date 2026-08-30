/**
 * Move unpaid campaigns waiting on validation back to DRAFT, for pay-first.
 *
 * Before pay-first the order was: submit -> admin validates -> pay. That left a
 * review queue full of campaigns nobody had paid for (133 on prod the day this
 * shipped) — Rufus's « je vois trop d'annonceurs blagueurs ». Under the new order
 * paying is what buys a place in the queue, so these have to go back to the
 * annonceur to pay first.
 *
 * Targets ONLY campaigns that are unpaid (no paidAt, no payment session) and in
 * PENDING_REVIEW. Deliberately NOT touched:
 *   - APPROVED: an admin already judged those, and the legacy pay->activate path
 *     still works for them, so bouncing them back would repeat review for nothing.
 *   - Anything paid, live, completed, banked, cancelled or rejected.
 *
 * Idempotent. Dry-run by default.
 *
 * Usage (on the server, in advertising-service/):
 *   npx ts-node src/scripts/migrate-unpaid-to-draft.ts          # dry run
 *   npx ts-node src/scripts/migrate-unpaid-to-draft.ts --apply  # execute
 */

import mongoose from 'mongoose';
import config from '../config';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';

const APPLY = process.argv.includes('--apply');

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log(APPLY ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to execute) ---');

    const filter = {
        status: CampaignStatus.PENDING_REVIEW,
        isTestCampaign: { $ne: true },
        // Unpaid on every signal we have.
        paidAt: { $exists: false },
        paymentSessionId: { $exists: false },
    };

    const candidates = await CampaignModel.find(filter).sort({ createdAt: 1 });
    console.log(`Found ${candidates.length} unpaid campaign(s) awaiting validation.\n`);

    for (const c of candidates) {
        console.log(`${APPLY ? 'MOVING ' : 'WOULD MOVE '}${c._id} | ${c.amountPaid} XAF | ${String(c.title).slice(0, 40)}`);
    }

    if (!APPLY) {
        console.log('\nNothing changed. Re-run with --apply.');
        await mongoose.disconnect();
        return;
    }

    const result = await CampaignModel.updateMany(filter, {
        $set: { status: CampaignStatus.DRAFT },
        // The campaign is no longer queued, so the review timestamps must not
        // linger — they order the queue and would misplace it if it is paid later.
        $unset: { submittedForReviewAt: 1, reviewedBy: 1, reviewedAt: 1 },
    });

    console.log(`\nMoved ${result.modifiedCount} campaign(s) back to DRAFT. Their annonceurs must now pay to enter the queue.`);
    await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
