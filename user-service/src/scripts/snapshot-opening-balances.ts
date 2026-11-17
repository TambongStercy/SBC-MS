/**
 * Opening balances for the wallet ledger (walletopeningbalances).
 *
 * Records, once per {user, currency}, the balance at the moment it is read;
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
 * Uses config.mongodb.uri (MONGODB_URI_* of the environment it runs in), or
 * SNAPSHOT_MONGO_URI when set.
 */
import mongoose from 'mongoose';
import config from '../config';
import UserModel from '../database/models/user.model';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';

const apply = process.argv.includes('--apply');

export async function snapshotOpeningBalances(opts: { apply: boolean; log?: (s: string) => void }) {
    const log = opts.log ?? console.log;
    if (opts.apply) await WalletOpeningBalanceModel.syncIndexes();
    const existing = new Set(
        (await WalletOpeningBalanceModel.find({}).select('userId currency').lean()).map((o: any) => `${o.userId}:${o.currency}`),
    );
    const totals = { users: 0, written: 0, skipped: 0, xaf: 0, usd: 0 };
    const cursor = UserModel.find({}).select('_id').lean().cursor();
    for await (const { _id } of cursor) {
        totals.users++;
        // Read each user at its own instant: that instant is its snapshotAt.
        const snapshotAt = new Date();
        const u: any = await UserModel.findById(_id).select('balance usdBalance debt').lean();
        if (!u) continue;
        for (const currency of ['XAF', 'USD'] as const) {
            if (existing.has(`${_id}:${currency}`)) { totals.skipped++; continue; }
            const amount = Number((currency === 'USD' ? u.usdBalance : u.balance) ?? 0);
            if (currency === 'XAF') totals.xaf += amount; else totals.usd += amount;
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
    log(`${totals.users} user(s); ${totals.written} opening row(s) ${opts.apply ? 'written' : 'would be written (dry run)'}; ${totals.skipped} already present.`);
    log(`Totals in the snapshot: ${Math.round(totals.xaf * 100) / 100} XAF, ${Math.round(totals.usd * 100) / 100} USD.`);
    if (!opts.apply) log('Nothing was written. Re-run with --apply to record the opening balances.');
    return totals;
}

if (require.main === module) {
    (async () => {
        const uri = process.env.SNAPSHOT_MONGO_URI || config.mongodb.uri;
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
        console.log(`Connected to ${mongoose.connection.name}${apply ? '' : ' (DRY RUN)'}`);
        await snapshotOpeningBalances({ apply });
        await mongoose.disconnect();
    })().catch(async (err) => {
        console.error(err);
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}
