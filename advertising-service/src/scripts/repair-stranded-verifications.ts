/**
 * Clear the verification queue of recordings that can never be validated.
 *
 * 71 recordings point at participations that were reset to OFFERED underneath
 * them (Rufus, 2026-09-06). The chain: manual verification only marks a day
 * VERIFIED on admin approval, so a diffuseur awaiting review still looked like
 * they had not posted; the deadline sweep forfeited them; on the test campaign a
 * forfeit makes them revivable, so the next sweep reset the participation and
 * wiped its days. Every attempt to validate then failed with "Cette
 * participation n'est pas en cours (statut : offered)" — permanently.
 *
 * Both causes are fixed going forward. This clears what is already stranded.
 *
 * What it does NOT do is silently discard the work. A recording still queued for
 * review on a live participation is left alone. Only ones whose participation was
 * reset — where the day it described no longer exists — are retired, because
 * there is nothing left for an admin to approve INTO.
 *
 * Dry run by default.
 *
 *   npx ts-node src/scripts/repair-stranded-verifications.ts
 *   npx ts-node src/scripts/repair-stranded-verifications.ts --apply
 */

import mongoose from 'mongoose';
import config from '../config';
import ManualVerificationModel, { ManualVerificationStatus } from '../database/models/manual-verification.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';

const APPLY = process.argv.includes('--apply');

const run = async () => {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log(APPLY ? '*** APPLY ***\n' : '--- DRY RUN (pass --apply) ---\n');

    const live = [ManualVerificationStatus.AWAITING_UPLOAD, ManualVerificationStatus.PENDING_REVIEW];
    const open = await ManualVerificationModel.find({ status: { $in: live } })
        .select('_id participationId status day uploadedAt');

    const participations = await CampaignParticipationModel
        .find({ _id: { $in: open.map(mv => mv.participationId) } })
        .select('_id status')
        .lean();
    const statusById = new Map(participations.map(p => [String(p._id), p.status]));

    // Anything not IN_PROGRESS has no day left for an approval to land on.
    const stranded = open.filter(mv => {
        const st = statusById.get(String(mv.participationId));
        return st !== ParticipationStatus.IN_PROGRESS;
    });

    const byStatus = new Map<string, number>();
    for (const mv of stranded) {
        const st = statusById.get(String(mv.participationId)) ?? 'MISSING';
        byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
    }

    console.log(`${open.length} open verification(s); ${stranded.length} stranded.`);
    for (const [st, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  participation ${st}: ${n}`);
    }

    const uploaded = stranded.filter(mv => mv.uploadedAt).length;
    if (uploaded) {
        console.log(
            `\n${uploaded} of these had a video actually uploaded — that is work a diffuseur\n`
            + 'did and will not be paid for. They are not re-payable from here: their days no\n'
            + 'longer exist. Worth telling them, and worth watching that the forfeit fix holds.',
        );
    }

    if (APPLY && stranded.length) {
        const res = await ManualVerificationModel.updateMany(
            { _id: { $in: stranded.map(mv => mv._id) } },
            { $set: { status: ManualVerificationStatus.EXPIRED } },
        );
        console.log(`\nRetired ${res.modifiedCount} stranded verification(s).`);
    }

    await mongoose.disconnect();
};

run().catch(async err => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
