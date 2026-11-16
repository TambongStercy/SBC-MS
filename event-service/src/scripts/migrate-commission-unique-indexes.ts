/**
 * One commission row per sale (Commission model: uniq_primary_orderId,
 * uniq_resaleOrderId). Mongoose creates new indexes on boot but never replaces
 * one that exists, and the old non-unique orderId_1 / resaleOrderId_1 sit on
 * the same keys — hence this one-shot migration.
 *
 * Dry run by default: reports duplicate rows (a duplicate blocks the unique
 * index; each was SBC revenue booked twice by a replayed webhook).
 *   npx ts-node --transpile-only src/scripts/migrate-commission-unique-indexes.ts
 *   npx ts-node --transpile-only src/scripts/migrate-commission-unique-indexes.ts --apply
 *
 * --apply drops the legacy indexes and builds the unique ones. It refuses while
 * duplicates exist; settle them by hand first (keep the oldest row).
 */
import mongoose from 'mongoose';
import config from '../config';
import Commission, { CommissionKind } from '../database/models/commission.model';

const APPLY = process.argv.includes('--apply');
const LEGACY = ['orderId_1', 'resaleOrderId_1'];

(async () => {
    await mongoose.connect(config.mongodb.uri);
    const coll = Commission.collection;

    const dupes = async (field: 'orderId' | 'resaleOrderId', match: Record<string, unknown>) =>
        Commission.aggregate([
            { $match: { ...match, [field]: { $exists: true, $ne: null } } },
            { $group: { _id: `$${field}`, n: { $sum: 1 }, ids: { $push: '$_id' }, amounts: { $push: '$amount' } } },
            { $match: { n: { $gt: 1 } } },
        ]);

    const primaryDupes = await dupes('orderId', { kind: CommissionKind.PRIMARY });
    const resaleDupes = await dupes('resaleOrderId', {});
    for (const d of primaryDupes) console.log(`DUPLICATE primary commission for order ${d._id}: rows ${d.ids.join(', ')} amounts ${d.amounts.join(', ')}`);
    for (const d of resaleDupes) console.log(`DUPLICATE resale commission for resale order ${d._id}: rows ${d.ids.join(', ')} amounts ${d.amounts.join(', ')}`);
    console.log(`${primaryDupes.length} primary + ${resaleDupes.length} resale duplicate groups.`);

    const existing = await coll.indexes();
    console.log(`Current indexes: ${existing.map((i) => i.name).join(', ')}`);

    if (!APPLY) {
        console.log('Dry run — nothing changed. Re-run with --apply.');
        await mongoose.disconnect();
        return;
    }
    if (primaryDupes.length || resaleDupes.length) {
        console.error('Refusing to build unique indexes while duplicates exist.');
        await mongoose.disconnect();
        process.exit(1);
    }

    for (const name of LEGACY) {
        if (existing.some((i) => i.name === name)) {
            await coll.dropIndex(name);
            console.log(`dropped ${name}`);
        }
    }
    await Commission.syncIndexes();
    console.log(`Indexes now: ${(await coll.indexes()).map((i) => i.name).join(', ')}`);
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
