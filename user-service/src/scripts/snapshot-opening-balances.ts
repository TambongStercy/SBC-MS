/**
 * Opening balances for the wallet ledger (walletopeningbalances).
 *
 * Records, once per {user, balance}, the balance at the moment it is read, for
 * the six journalled balances (WALLET_FIELDS: XAF, USD, and since 2026-11-23
 * ACTIVATION, ADVERTISING, EVENT_ORGANIZER, SBC_LIVE);
 * the nightly ledger check (jobs/ledger-check.job.ts) then expects
 *   opening + Σ movements applied after snapshotAt = current balance.
 *
 * Run it right after the release that introduces walletmovements is live, so
 * that every later change is journalled. Each user is read and recorded in turn
 * with its own snapshotAt; a movement applied while the script runs lands
 * either before the read (inside the opening) or after it (appliedAt >
 * snapshotAt). Only a movement caught in the few milliseconds between its
 * balance write and its APPLIED mark can be counted twice; the nightly check
 * would report that user. Users who already have an opening row are skipped,
 * so re-running is safe.
 *
 * DRY RUN by default: prints counts and totals, writes nothing.
 *   npx ts-node --transpile-only src/scripts/snapshot-opening-balances.ts
 *   npx ts-node --transpile-only src/scripts/snapshot-opening-balances.ts --apply
 *   … --balances=ACTIVATION,ADVERTISING   (only these; default: all six)
 * Uses config.mongodb.uri (MONGODB_URI_* of the environment it runs in), or
 * SNAPSHOT_MONGO_URI when set.
 */
import mongoose from 'mongoose';
import config from '../config';
import UserModel from '../database/models/user.model';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';
import { WALLET_CURRENCIES, WALLET_FIELDS, WalletCurrency, isWalletCurrency } from '../database/models/wallet-movement.model';

const apply = process.argv.includes('--apply');
const balancesArg = process.argv.find((a) => a.startsWith('--balances='))?.split('=')[1];

export async function snapshotOpeningBalances(opts: { apply: boolean; balances?: WalletCurrency[]; log?: (s: string) => void }) {
    const balances = opts.balances?.length ? opts.balances : WALLET_CURRENCIES;
    const log = opts.log ?? console.log;
    // The Blnk sync holds back a balance's movements of members without an opening while its
    // snapshot runs (blnk-sync.service openingSnapshotState); mark the start and the end.
    const { markOpeningSnapshot } = await import('../services/blnk/blnk-sync.service');
    if (opts.apply) {
        await WalletOpeningBalanceModel.syncIndexes();
        for (const c of balances) await markOpeningSnapshot(c, 'startedAt');
    }
    const existing = new Set(
        (await WalletOpeningBalanceModel.find({}).select('userId currency').lean()).map((o: any) => `${o.userId}:${o.currency}`),
    );
    const totals = { users: 0, written: 0, skipped: 0, xaf: 0, usd: 0, byBalance: {} as Record<string, { rows: number; total: number }> };
    const cursor = UserModel.find({}).select('_id').lean().cursor();
    for await (const { _id } of cursor) {
        totals.users++;
        // Read each user at its own instant: that instant is its snapshotAt.
        const snapshotAt = new Date();
        const u: any = await UserModel.findById(_id).select(`${Object.values(WALLET_FIELDS).join(' ')} debt`).lean();
        if (!u) continue;
        for (const currency of balances) {
            if (existing.has(`${_id}:${currency}`)) { totals.skipped++; continue; }
            const amount = Number(u[WALLET_FIELDS[currency]] ?? 0);
            if (currency === 'XAF') totals.xaf += amount; else if (currency === 'USD') totals.usd += amount;
            const b = (totals.byBalance[currency] ??= { rows: 0, total: 0 });
            b.rows++; b.total += amount;
            if (opts.apply) {
                try {
                    await WalletOpeningBalanceModel.create({ userId: _id, currency, amount, debt: currency === 'XAF' ? Math.max(0, u.debt ?? 0) : undefined, snapshotAt });
                } catch (e: any) {
                    if (e?.code !== 11000) throw e;
                    totals.skipped++;
                    continue;
                }
            }
            totals.written++;
        }
    }
    if (opts.apply) for (const c of balances) await markOpeningSnapshot(c, 'doneAt');
    log(`${totals.users} user(s); ${totals.written} opening row(s) ${opts.apply ? 'written' : 'would be written (dry run)'}; ${totals.skipped} already present.`);
    for (const [k, v] of Object.entries(totals.byBalance)) log(`  ${k}: ${v.rows} row(s), total ${Math.round(v.total * 100) / 100}`);
    if (!opts.apply) log('Nothing was written. Re-run with --apply to record the opening balances.');
    return totals;
}

if (require.main === module) {
    (async () => {
        const uri = process.env.SNAPSHOT_MONGO_URI || config.mongodb.uri;
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
        console.log(`Connected to ${mongoose.connection.name}${apply ? '' : ' (DRY RUN)'}`);
        const list = balancesArg ? balancesArg.split(',').map((b) => b.trim().toUpperCase()) : undefined;
        if (list && !list.every(isWalletCurrency)) throw new Error(`--balances must list some of ${WALLET_CURRENCIES.join(', ')}`);
        await snapshotOpeningBalances({ apply, balances: list as WalletCurrency[] | undefined });
        await mongoose.disconnect();
    })().catch(async (err) => {
        console.error(err);
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}
