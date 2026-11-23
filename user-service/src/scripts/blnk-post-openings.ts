/**
 * Security plan Phase 2: puts every member's opening balance (walletopeningbalances,
 * the snapshot of 2026-11-21 on preprod) into Blnk, so the nightly comparison
 * covers members who have not moved money since. Each member gets a Blnk
 * balance per currency and one transaction from @OpeningBalances (reference
 * `opening:<userId>:<currency>`, posted once). Resumable: members already done
 * are skipped. Zero openings are skipped too (on preprod 437,548 of 446,774): such a
 * member gets a Blnk balance at their first movement, and the withdrawal pre-check
 * refuses a non-zero balance that Blnk does not know (`not_in_ledger`).
 * `--include-zero` creates their (empty) balances anyway.
 *
 *   node dist/scripts/blnk-post-openings.js                 dry run: counts
 *   node dist/scripts/blnk-post-openings.js --apply         posts (5 at a time)
 *   … --apply --limit=1000 --concurrency=10
 *   … --balances=ACTIVATION,ADVERTISING,EVENT_ORGANIZER,SBC_LIVE   (only these; 2026-11-23)
 *
 * The plan asks for the CORRECTED opening balance (after the historical
 * reconciliation). This posts the snapshot; members whose history does not
 * explain their balance are corrected later through @Adjustments, with approval.
 */
import mongoose from 'mongoose';
import connectDB from '../database/connection';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';
import { WalletCurrency, isWalletCurrency } from '../database/models/wallet-movement.model';
import { BlnkBalanceModel } from '../database/models/blnk.model';
import { blnkEnabled } from '../services/blnk/blnk.client';
import { ensureMemberBalance } from '../services/blnk/blnk-sync.service';

const arg = (name: string, d: number) => {
    const a = process.argv.find(x => x.startsWith(`--${name}=`));
    return a ? Math.max(1, Number(a.split('=')[1]) || d) : d;
};

async function main() {
    const apply = process.argv.includes('--apply');
    const limit = arg('limit', Number.MAX_SAFE_INTEGER);
    const concurrency = Math.min(arg('concurrency', 5), 20);
    const includeZero = process.argv.includes('--include-zero');
    const only = process.argv.find(x => x.startsWith('--balances='))?.split('=')[1]?.split(',').map(b => b.trim().toUpperCase());
    if (only && !only.every(isWalletCurrency)) throw new Error('--balances: XAF, USD, ACTIVATION, ADVERTISING, EVENT_ORGANIZER, SBC_LIVE');
    await connectDB();
    if (apply && !blnkEnabled()) throw new Error('BLNK_URL / BLNK_API_KEY are not set');
    const done = new Set((await BlnkBalanceModel.find({ openingPosted: true }, { userId: 1, currency: 1 }).lean()).map((r: any) => `${r.userId}:${r.currency}`));
    let todo = 0, posted = 0, failed = 0, zero = 0;
    const totals: Record<string, number> = {};
    const queue: { userId: any; currency: WalletCurrency; amount: number }[] = [];
    for await (const o of WalletOpeningBalanceModel.find(only ? { currency: { $in: only } } : {}, { userId: 1, currency: 1, amount: 1 }).sort({ _id: 1 }).lean().cursor()) {
        if (done.has(`${o.userId}:${o.currency}`)) continue;
        if (!includeZero && !o.amount) { zero++; continue; }
        todo++;
        totals[o.currency] = (totals[o.currency] ?? 0) + o.amount;
        if (apply && queue.length < limit) queue.push(o as any);
    }
    const byBalance = Object.entries(totals).map(([c, t]) => `${c} ${Math.round(t * 100) / 100}`).join(', ');
    process.stdout.write(`${todo} opening balance(s) not yet in Blnk (${byBalance || 'none'})${zero ? `; ${zero} zero opening(s) skipped` : ''}\n`);
    if (!apply) {
        process.stdout.write('Dry run: nothing posted. Add --apply.\n');
    } else {
        let i = 0;
        const workerFn = async () => {
            while (i < queue.length) {
                const o = queue[i++];
                try { await ensureMemberBalance(o.userId, o.currency); posted++; }
                catch (err: any) { failed++; if (failed <= 20) process.stderr.write(`failed ${o.userId} ${o.currency}: ${err?.message ?? err}\n`); }
                if ((posted + failed) % 1000 === 0) process.stdout.write(`… ${posted + failed}/${queue.length}\n`);
            }
        };
        await Promise.all(Array.from({ length: concurrency }, workerFn));
        process.stdout.write(`${posted} posted, ${failed} failed (run again to retry).\n`);
    }
    await mongoose.disconnect();
}
main().then(() => process.exit(0)).catch(err => { process.stderr.write(`${err?.stack || err}\n`); process.exit(1); });
