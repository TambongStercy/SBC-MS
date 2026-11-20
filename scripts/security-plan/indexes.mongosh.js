/*
 * Security plan, Phase 0 item 5: the indexes later phases query on, and a
 * report on the duplicate `referrals` indexes.
 *
 * DRY RUN by default: says what exists, what is missing, and how big each
 * collection is. Nothing is created unless APPLY = true. Nothing is ever
 * dropped: the `referrals` indexes are declared in the Mongoose schema, so a
 * dropped one would be rebuilt at the next restart; remove it from the schema
 * first (the report says which are candidates).
 *
 * Run it on PREPROD first to time each build, then on prod at night
 * (02:00–05:00 Douala, the plan's heavy-job window). MongoDB 4.2+ builds
 * without blocking reads and writes except briefly at the start and end.
 *
 *   mongosh --quiet mongodb://localhost:27017 \
 *     --eval 'var USERS_DB="sbc_users_preprod", PAYMENT_DB="sbc_payment_preprod", APPLY=false' \
 *     scripts/security-plan/indexes.mongosh.js
 *
 * Prod: USERS_DB="sbc_users", PAYMENT_DB="sbc_payment". Local: sbc_user_dev, sbc_payment_dev.
 */

/* global db, print, printjson, USERS_DB, PAYMENT_DB, APPLY */
const apply = typeof APPLY !== 'undefined' && APPLY === true;
if (typeof USERS_DB === 'undefined' || typeof PAYMENT_DB === 'undefined') {
    print('Set USERS_DB and PAYMENT_DB (see the header). Nothing done.');
    quit(1);
}

/*
 * Every index is partial on its field existing, so documents without the
 * field (most of them, for fields later phases add) cost nothing.
 */
const PLANNED = [
    // Phase 4 (linked accounts: shared payout number), Phase 0 MoMo lock.
    { db: USERS_DB, coll: 'users', name: 'secplan_momoNumber', key: { momoNumber: 1 },
        opts: { partialFilterExpression: { momoNumber: { $type: 'string' } } } },
    // Phase 1 / 7: activity and dormancy (fields added by those phases).
    { db: USERS_DB, coll: 'users', name: 'secplan_geo_lastActiveAt', key: { 'geo.lastActiveAt': -1 },
        opts: { partialFilterExpression: { 'geo.lastActiveAt': { $exists: true } } } },
    { db: USERS_DB, coll: 'users', name: 'secplan_dormancy_status', key: { 'dormancy.status': 1 },
        opts: { partialFilterExpression: { 'dormancy.status': { $exists: true } } } },
    // Phase 4: withdrawals to the same number from several accounts.
    { db: PAYMENT_DB, coll: 'transactions', name: 'secplan_payout_number', key: { 'metadata.accountInfo.fullMomoNumber': 1, createdAt: -1 },
        opts: { partialFilterExpression: { 'metadata.accountInfo.fullMomoNumber': { $exists: true } } } },
    // Phase 2: the Blnk outbox.
    { db: PAYMENT_DB, coll: 'transactions', name: 'secplan_blnk_status', key: { 'blnk.status': 1, createdAt: 1 },
        opts: { partialFilterExpression: { 'blnk.status': { $exists: true } } } },
    // Phase 10: the "Échecs" list (cursor pagination by group).
    { db: PAYMENT_DB, coll: 'paymentintents', name: 'secplan_failure_group', key: { 'failure.group': 1, createdAt: -1 },
        opts: { partialFilterExpression: { failure: { $exists: true } } } },
    // Phase 10: the stuck-payment job (status + gateway, oldest update first).
    { db: PAYMENT_DB, coll: 'paymentintents', name: 'secplan_status_gateway_updated', key: { status: 1, gateway: 1, updatedAt: 1 }, opts: {} },
];

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

print(`${apply ? 'APPLY' : 'DRY RUN'} — ${new Date().toISOString()}\n`);

for (const p of PLANNED) {
    const d = db.getSiblingDB(p.db);
    const c = d.getCollection(p.coll);
    const existing = c.getIndexes();
    const match = existing.find(i => i.name === p.name || sameKey(i.key, p.key));
    const label = `${p.db}.${p.coll} ${JSON.stringify(p.key)}`;
    if (match) {
        print(`OK      ${label} — already there as ${match.name}`);
        continue;
    }
    const stats = d.runCommand({ collStats: p.coll });
    print(`MISSING ${label} — ${stats.count ?? '?'} docs, ${mb(stats.size || 0)} data, ${existing.length} indexes today`);
    if (apply) {
        const t = Date.now();
        const res = c.createIndex(p.key, { name: p.name, ...p.opts });
        const after = c.stats({ indexDetails: false }).indexSizes?.[p.name];
        print(`        created ${res} in ${((Date.now() - t) / 1000).toFixed(1)} s, size ${after !== undefined ? mb(after) : '?'}`);
    }
}

/*
 * referrals: duplicates and prefixes. An index whose key is the start of a
 * longer one (same direction, neither unique/partial/sparse) serves no query
 * the longer one cannot; it only slows every write.
 */
print(`\n${USERS_DB}.referrals indexes (usage since the last mongod restart):`);
const refs = db.getSiblingDB(USERS_DB).getCollection('referrals');
const idx = refs.getIndexes();
const usage = {};
try {
    refs.aggregate([{ $indexStats: {} }]).forEach(s => { usage[s.name] = { ops: s.accesses.ops, since: s.accesses.since }; });
} catch (e) { print(`  ($indexStats unavailable: ${e.message})`); }
const plain = i => !i.unique && !i.partialFilterExpression && !i.sparse && !i.collation;
const isPrefix = (a, b) => {
    const ka = Object.entries(a.key);
    const kb = Object.entries(b.key);
    return ka.length < kb.length && ka.every(([f, dir], n) => kb[n][0] === f && kb[n][1] === dir);
};
for (const i of idx) {
    if (i.name === '_id_') continue;
    const dup = idx.find(o => o !== i && sameKey(o.key, i.key));
    const longer = idx.find(o => o !== i && plain(i) && isPrefix(i, o));
    const u = usage[i.name];
    const verdict = dup ? `DUPLICATE of ${dup.name}`
        : longer ? `REDUNDANT: prefix of ${longer.name}`
            : '';
    print(`  ${i.name.padEnd(52)} ops=${u ? String(u.ops).padStart(9) : '        ?'}  ${verdict}`);
}
print('\nDrop a REDUNDANT/DUPLICATE index only after removing it from the Mongoose schema (it would be rebuilt at startup),');
print('and look at ops= first: an index with no use since a long-running restart is a candidate even if not redundant.');
print(apply ? '\nDone.' : '\nDry run: nothing created. Re-run with APPLY=true at night.');
