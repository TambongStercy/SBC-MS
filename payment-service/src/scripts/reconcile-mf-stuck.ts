/**
 * Reconcile stuck MoneyFusion payout withdrawals.
 *
 * Why this exists: MoneyFusion frequently drops the payout webhook (or we lose
 * the tokenPay in the race documented in CLAUDE.md), leaving withdrawals stuck
 * in PROCESSING even though MF actually paid out. The admin "Fix MoneyFusion
 * Withdrawals" page normally resolves these, but its list endpoint is currently
 * broken. This script does the same reconciliation without the page.
 *
 * How: it replays the real success webhook against the live payment-service, so
 * the exact production code path runs (mark COMPLETED + debit-on-success gross
 * debit, idempotent). For a transaction with no stored provider token (the ones
 * that lost the tokenPay), it first plants a self-describing sentinel in
 * externalTransactionId (RECON-<txId>) so the handler can find it — the pattern
 * CLAUDE.md prescribes for stuck-withdrawal recovery. A reconciliation marker is
 * stamped for audit.
 *
 * SAFETY:
 *   - Dry-run by default. Pass --apply to actually reconcile.
 *   - Only touches WITHDRAWAL + MoneyFusion + PROCESSING/PENDING transactions.
 *   - Idempotent: the webhook handler no-ops a transaction already COMPLETED.
 *   - This DEBITS user wallets (debit-on-success). Only run it for payouts you
 *     have confirmed actually left MoneyFusion.
 *
 * Usage (on the server, in payment-service/):
 *   npx ts-node src/scripts/reconcile-mf-stuck.ts                 # dry run, all stuck MF
 *   npx ts-node src/scripts/reconcile-mf-stuck.ts --apply         # reconcile all stuck MF
 *   npx ts-node src/scripts/reconcile-mf-stuck.ts --apply id1 id2 # only these transactionIds
 *   npx ts-node src/scripts/reconcile-mf-stuck.ts --apply --fail id1 # MF never got it
 *   npx ts-node src/scripts/reconcile-mf-stuck.ts --apply --reason "..." id1
 *
 * Pass --reason whenever the default is not what happened. A payout an admin
 * settled by hand is NOT a provider success, and the record has to say so.
 */

import mongoose from 'mongoose';
import axios from 'axios';
import config from '../config';
import TransactionModel, { TransactionType, TransactionStatus } from '../database/models/transaction.model';

const APPLY = process.argv.includes('--apply');
/**
 * Mark the payout FAILED instead of completed, for one MoneyFusion never
 * received. Debit-on-success means the wallet was never touched, so failing it
 * simply releases the user to withdraw again — no refund is owed or made.
 */
const FAIL = process.argv.includes('--fail');

/**
 * What actually happened, in the audit trail.
 *
 * The default says MF paid and we lost the webhook, which is true of the batch
 * this was written for and false of anything else. A payout settled by hand — MF
 * never confirmed, an admin sent the money themselves — must not be recorded as a
 * provider success: that is precisely the row CLAUDE.md warns about, a COMPLETED
 * withdrawal that assumed delivery without ever verifying it.
 */
const reasonArg = (() => {
    const i = process.argv.indexOf('--reason');
    return i > -1 ? process.argv[i + 1] : undefined;
})();

const ONLY_IDS = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--reason');

const WEBHOOK_URL = `http://localhost:${config.port}/api/payments/webhooks/moneyfusion/payout`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isMoneyFusion = (t: any): boolean =>
    t.serviceProvider === 'MoneyFusion' || t?.metadata?.selectedPayoutService === 'MoneyFusion';

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log(`Connected. Webhook target: ${WEBHOOK_URL}`);
    console.log(
        APPLY
            ? (FAIL
                ? '*** APPLY MODE — marking FAILED (no wallet movement) ***'
                : '*** APPLY MODE — wallets WILL be debited ***')
            : '--- DRY RUN (no changes) — pass --apply to execute ---',
    );

    const query: any = {
        type: TransactionType.WITHDRAWAL,
        status: { $in: [TransactionStatus.PROCESSING, TransactionStatus.PENDING] },
        $or: [{ serviceProvider: 'MoneyFusion' }, { 'metadata.selectedPayoutService': 'MoneyFusion' }],
    };
    if (ONLY_IDS.length) query.transactionId = { $in: ONLY_IDS };

    const stuck = await TransactionModel.find(query).sort({ createdAt: 1 });
    console.log(`Found ${stuck.length} stuck MoneyFusion withdrawal(s)${ONLY_IDS.length ? ` (filtered to ${ONLY_IDS.length} id(s))` : ''}.\n`);

    let done = 0, skipped = 0, failed = 0;

    for (const t of stuck) {
        const tag = `${t.transactionId} | ${t.amount} XAF | ${t?.metadata?.accountInfo?.fullMomoNumber ?? '?'} | ${new Date(t.createdAt).toISOString().slice(0, 10)}`;

        if (!isMoneyFusion(t)) { console.log(`SKIP (not MF): ${tag}`); skipped++; continue; }

        // Reuse a real provider token if we have one; otherwise plant a sentinel so
        // the webhook handler (which finds the tx by externalTransactionId) matches.
        const token = t.externalTransactionId && !t.externalTransactionId.startsWith('RECON-')
            ? t.externalTransactionId
            : `RECON-${t.transactionId}`;

        if (!APPLY) { console.log(`WOULD RECONCILE: ${tag} (token=${token})`); continue; }

        try {
            if (!t.externalTransactionId) {
                await TransactionModel.updateOne(
                    { transactionId: t.transactionId, status: { $in: [TransactionStatus.PROCESSING, TransactionStatus.PENDING] } },
                    {
                        $set: {
                            externalTransactionId: token,
                            'metadata.reconciliation': {
                                by: 'reconcile-mf-stuck.ts',
                                at: new Date().toISOString(),
                                method: 'webhook-simulation',
                                reason: reasonArg ?? (FAIL
                                    ? 'MoneyFusion never received the payout; cancelled so the user can withdraw again'
                                    : 'MF dropped payout webhook; fix page bugged; batch reconcile'),
                                // False unless a real provider token was reused: a
                                // planted RECON- sentinel means nothing was ever
                                // confirmed by MoneyFusion.
                                providerConfirmed: false,
                            },
                        },
                    },
                );
            }

            await axios.post(
                WEBHOOK_URL,
                { event: FAIL ? 'payout.session.cancelled' : 'payout.session.completed', tokenPay: token },
                { timeout: 15000 },
            );
            await sleep(400); // let the handler's async debit settle before we re-read

            const after = await TransactionModel.findOne({ transactionId: t.transactionId }).lean();
            const expected = FAIL ? TransactionStatus.FAILED : TransactionStatus.COMPLETED;
            if (after?.status === expected) {
                console.log(FAIL ? `OK   FAILED, wallet untouched: ${tag}` : `OK   COMPLETED + debited: ${tag}`);
                done++;
            } else {
                console.log(`WARN not completed (status=${after?.status}): ${tag}`);
                failed++;
            }
        } catch (err: any) {
            console.log(`FAIL ${tag}: ${err?.response?.data?.message || err.message}`);
            failed++;
        }
    }

    console.log(`\nSummary: ${APPLY ? 'reconciled' : 'would reconcile'} ${APPLY ? done : stuck.length}, skipped ${skipped}, failed ${failed}.`);
    await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
