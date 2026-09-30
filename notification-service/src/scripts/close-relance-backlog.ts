/**
 * Closes relance-des-nouveaux targets that were enrolled too long ago.
 *
 * Relance stopped sending in early May 2026 (the credit callback never credited
 * anyone), while enrollment kept going. By 2026-09-30, 8,511 filleuls sat at
 * day 0 — some since 7 May — waiting for a first message. Once credits land,
 * the sender would send every one of them day 1 at once, including people who
 * registered five months ago.
 *
 * Decision (Sterling, 2026-09-30): filleuls enrolled in the last 30 days keep
 * their 7-day relance; older ones are closed quietly with exitReason 'expired'.
 * Campaign targets are not touched — a campaign is a deliberate choice by the
 * parrain.
 *
 *   npx ts-node src/scripts/close-relance-backlog.ts                # dry run
 *   npx ts-node src/scripts/close-relance-backlog.ts --apply
 *   npx ts-node src/scripts/close-relance-backlog.ts --days 45      # other cutoff
 */
import mongoose from 'mongoose';
import config from '../config';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 30;

export const backlogFilter = (cutoff: Date) => ({
    status: TargetStatus.ACTIVE,
    campaignId: null,
    enteredLoopAt: { $lt: cutoff },
});

export async function closeRelanceBacklog(days: number, apply: boolean, now = new Date()) {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const filter = backlogFilter(cutoff);

    const [toClose, toKeep, byReferrer] = await Promise.all([
        RelanceTargetModel.countDocuments(filter),
        RelanceTargetModel.countDocuments({ status: TargetStatus.ACTIVE, campaignId: null, enteredLoopAt: { $gte: cutoff } }),
        RelanceTargetModel.aggregate([
            { $match: { status: TargetStatus.ACTIVE, campaignId: null } },
            {
                $group: {
                    _id: '$referrerUserId',
                    close: { $sum: { $cond: [{ $lt: ['$enteredLoopAt', cutoff] }, 1, 0] } },
                    keep: { $sum: { $cond: [{ $gte: ['$enteredLoopAt', cutoff] }, 1, 0] } },
                },
            },
            { $sort: { close: -1 } },
        ]),
    ]);

    let closed = 0;
    if (apply && toClose > 0) {
        const res = await RelanceTargetModel.updateMany(filter, {
            $set: { status: TargetStatus.COMPLETED, exitReason: ExitReason.EXPIRED, exitedLoopAt: now },
        });
        closed = res.modifiedCount;
    }
    return { cutoff, toClose, toKeep, byReferrer, closed };
}

const main = async () => {
    if (!Number.isFinite(DAYS) || DAYS < 1) throw new Error(`--days must be a positive number, got ${DAYS}`);
    await mongoose.connect(config.mongodb.uri);

    const r = await closeRelanceBacklog(DAYS, APPLY);
    console.log(APPLY ? '*** APPLY ***' : '--- DRY RUN (pass --apply to close) ---');
    console.log(`Cutoff: enrolled before ${r.cutoff.toISOString()} (${DAYS} days)`);
    console.log(`Relance des nouveaux, still active: close ${r.toClose}, keep ${r.toKeep}\n`);
    console.log('Per parrain (close / keep):');
    for (const row of r.byReferrer) console.log(`  ${row._id}  ${String(row.close).padStart(6)} / ${row.keep}`);
    if (APPLY) console.log(`\nClosed ${r.closed} target(s) with exitReason '${ExitReason.EXPIRED}'.`);

    await mongoose.disconnect();
};

if (require.main === module) {
    main().catch(async err => {
        console.error('Failed:', err);
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}
