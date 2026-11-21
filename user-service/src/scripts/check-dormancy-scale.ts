/**
 * Security plan Phase 7, scale criteria (local Mongo, own database, dropped after):
 *   - summary p95 under 500 ms at 10x data (default 300,000 accounts, ~10x
 *     today's ~29,000 holding money: DORMANCY_SCALE to change);
 *   - list first page p95 (biggest first, filtered);
 *   - a CSV export of 100,000 rows completes in the background while the list
 *     keeps answering (latency during the export vs before).
 *
 *   npx ts-node --transpile-only src/scripts/check-dormancy-scale.ts
 */
import mongoose, { Types } from 'mongoose';

const DB = process.env.DORMANCY_SCALE_DB || 'mongodb://127.0.0.1:27017/sbc_users_dormancy_scale';
const N = Number(process.env.DORMANCY_SCALE || 300_000);
process.env.DORMANCY_REACTIVATION_HOLD = 'log';
delete process.env.RISK_SERVICE_URL;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95) - 1] ?? 0;
async function timeIt(times: number, fn: () => Promise<unknown>) {
    const out: number[] = [];
    for (let i = 0; i < times; i++) { const t = performance.now(); await fn(); out.push(performance.now() - t); }
    return out;
}

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const dz = await import('../services/dormancy.service');
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await UserModel.syncIndexes();

    console.log(`Inserting ${N} accounts…`);
    const DAY = 86_400_000;
    const countries = ['CM', 'BJ', 'TG', 'CI', 'SN', 'CG', 'BF', 'GA'];
    for (let start = 0; start < N; start += 10_000) {
        const docs = [];
        for (let i = start; i < Math.min(N, start + 10_000); i++) {
            const daysAgo = i % 3 === 0 ? 20 : 100 + (i % 500); // two thirds inactive 90+ days
            docs.push({
                _id: new Types.ObjectId(), name: `Scale ${i}`, email: `scale.${i}@e2e.test`, phoneNumber: `2376${String(i).padStart(8, '0')}`,
                password: 'x', referralCode: `SCALE${i}`, country: countries[i % countries.length], role: 'user', deleted: false, blocked: false,
                balance: (i * 37) % 300_000, usdBalance: i % 50 === 0 ? 10 : 0, activationBalance: 0, advertisingBalance: 0, eventOrganizerBalance: 0, sbcLiveBalance: 0,
                createdAt: new Date(Date.now() - (daysAgo + 400) * DAY), ipLastUpdated: new Date(Date.now() - daysAgo * DAY),
            });
        }
        await UserModel.collection.insertMany(docs, { ordered: false });
    }

    let t = performance.now();
    const run = await dz.runDormancyPass();
    const passMs = performance.now() - t;
    check(`nightly pass over ${run?.accounts} accounts (${run?.dormant} inactive 90+)`, !!run?.checkOk, `${Math.round(passMs / 1000)} s`);

    dz.resetDormancySummaryCache();
    const sumTimes = await timeIt(40, async () => { dz.resetDormancySummaryCache(); await dz.dormancySummary(); });
    check('summary p95 < 500 ms (cache off)', p95(sumTimes) < 500, `p95 ${p95(sumTimes).toFixed(1)} ms`);

    const filters = [{}, { country: 'TG' }, { status: 'long_dormant' as const, minXaf: 100_000 }, { authenticator: false, withdrawal: 'never' as const }];
    const listOnce = async () => { for (const f of filters) await dz.listDormant(f); };
    const listBefore = await timeIt(10, listOnce);
    check('list first pages (4 filters, with totals) p95 < 1500 ms', p95(listBefore) < 1500, `p95 ${p95(listBefore).toFixed(0)} ms for 4 lists`);
    const deep = await dz.listDormant({}, { limit: 200 });
    t = performance.now();
    await dz.listDormant({}, { cursor: deep.nextCursor, limit: 200 });
    check('a later page by cursor stays fast', performance.now() - t < 300, `${(performance.now() - t).toFixed(0)} ms`);

    // Export ~100,000 rows (status long_dormant or all, whichever is closer) while listing.
    const target = (await dz.listDormant({})).totals!.count;
    const ex = await dz.startExport({}, 'scale-admin');
    const during: number[] = [];
    let st: any;
    t = performance.now();
    for (;;) {
        st = await dz.exportStatus(ex.id);
        if (st?.status !== 'running') break;
        const s = performance.now(); await dz.listDormant({ country: 'TG' }); during.push(performance.now() - s);
    }
    const exportMs = performance.now() - t;
    const before1 = await timeIt(10, () => dz.listDormant({ country: 'TG' }));
    check(`export of ${st?.rows} rows done in the background`, st?.status === 'done' && st.rows === target, `${Math.round(exportMs / 1000)} s`);
    check('list latency during the export stays within 2x + 50 ms of normal', during.length > 0 && p95(during) <= p95(before1) * 2 + 50,
        `during p95 ${p95(during).toFixed(0)} ms vs ${p95(before1).toFixed(0)} ms, ${during.length} calls`);

    await dz.clearOldExports(new Date(Date.now() + 25 * 3_600_000));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(err => { console.error(err); process.exit(1); });
