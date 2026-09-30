/**
 * Drops the legacy `qrToken_1` unique+sparse index on tickets.
 *
 * Why this exists: sparse indexes only skip documents where the field is
 * ABSENT. An invalidated ticket (refund, or the old ticket of a resale) stores
 * an explicit `qrToken: null`, which sparse still indexes — so the SECOND
 * invalidated ticket hit E11000 and the settlement threw, leaving a buyer who
 * had paid without a ticket. The model now declares a PARTIAL unique index
 * (`qrToken_unique_str`, string values only); Mongoose will create it on boot
 * but never replaces an index that already exists, hence this one-shot drop.
 *
 * Idempotent: run it as many times as you like.
 *   npx ts-node --transpile-only src/scripts/fix-qr-token-index.ts
 */
import mongoose from 'mongoose';
import config from '../config';
import Ticket from '../database/models/ticket.model';

const LEGACY = 'qrToken_1';
const WANTED = 'qrToken_unique_str';

(async () => {
    await mongoose.connect(config.mongodb.uri);
    const coll = Ticket.collection;

    const before = await coll.indexes();
    const legacy = before.find((i) => i.name === LEGACY);
    if (legacy) {
        await coll.dropIndex(LEGACY);
        console.log(`dropped legacy index ${LEGACY} (${JSON.stringify(legacy.key)}, sparse=${!!legacy.sparse})`);
    } else {
        console.log(`legacy index ${LEGACY} absent — nothing to drop`);
    }

    if (!before.some((i) => i.name === WANTED)) {
        await coll.createIndex(
            { qrToken: 1 },
            { unique: true, name: WANTED, partialFilterExpression: { qrToken: { $type: 'string' } } },
        );
        console.log(`created ${WANTED}`);
    } else {
        console.log(`${WANTED} already present`);
    }

    const after = await coll.indexes();
    console.log('qrToken indexes now:', JSON.stringify(after.filter((i) => JSON.stringify(i.key).includes('qrToken'))));
    await mongoose.disconnect();
})().catch(async (e) => {
    console.error('FAILED', e?.message);
    await mongoose.disconnect();
    process.exit(1);
});
