/**
 * Puts FAILED animation notifications back in the outbox queue — after a
 * notification-service outage, for example. Dry run by default.
 *
 *   npx ts-node --transpile-only src/scripts/requeue-anim-outbox.ts            # count only
 *   npx ts-node --transpile-only src/scripts/requeue-anim-outbox.ts --apply    # requeue
 *   ... --since 2026-10-01T00:00:00Z   only notices created after that date (default: last 7 days)
 *
 * Results and prizes stay meaningful for a while; a "candidature validée"
 * from weeks ago does not, hence the --since window.
 */
import mongoose from 'mongoose';
import config from '../config';
import { AnimOutbox } from '../modules/animation/models/governance.model';

const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
    const apply = process.argv.includes('--apply');
    const since = arg('--since') ? new Date(String(arg('--since'))) : new Date(Date.now() - 7 * 24 * 3_600_000);
    if (Number.isNaN(since.getTime())) throw new Error('--since must be a date');
    await mongoose.connect(config.mongodb.uri);

    const filter = { status: 'FAILED', createdAt: { $gte: since } };
    const byKind = await AnimOutbox.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$kind', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    const total = byKind.reduce((s, k) => s + k.n, 0);
    console.log(`FAILED notices since ${since.toISOString()}: ${total}`);
    for (const k of byKind) console.log(`  ${k._id.padEnd(30)} ${k.n}`);

    if (apply && total) {
        const res = await AnimOutbox.updateMany(filter, { $set: { status: 'PENDING', attempts: 0, nextAt: new Date() } });
        console.log(`Requeued ${res.modifiedCount}. The animation job sends them within one tick.`);
    } else if (!apply) {
        console.log('Dry run. Re-run with --apply to requeue.');
    }
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
