import cron from 'node-cron';
import logger from '../utils/logger';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { PaymentStatus, PaymentGateway } from '../database/interfaces/IPaymentIntent';
import paymentService from '../services/payment.service';
import { moneyFusionService } from '../services/moneyfusion.service';

const log = logger.getLogger('PayinReconciler');

/**
 * Asks the provider what happened to payments we were never told about.
 *
 * Withdrawals have had TransactionStatusChecker for a long time; incoming
 * payments had nothing. So a single dropped payin webhook was permanent: the
 * money left the payer's account, the intent sat in PENDING_PROVIDER forever,
 * and the app kept showing « Payer et envoyer à la validation » to someone who
 * had already paid. Georgi (2026-09-05, session Mh2-KxbcsQif) paid 6000 XOF for
 * a campaign, MTN Benin confirmed the debit by SMS, and the campaign stayed a
 * draft asking him to pay again.
 *
 * This only ever applies what the provider itself confirms. A network error, a
 * timeout or a 502 leaves the intent exactly as it was, to be retried next tick
 * — an unreachable provider is not evidence a payment failed.
 */

/**
 * Gateways whose payin status can actually be queried.
 *
 * CinetPay was left out of the first version on the belief that it had a payout
 * status API but no payin equivalent. That was wrong: GET /v1/payment/{token} is
 * the very call handleCinetPayWebhook already makes to verify itself. The
 * exclusion meant a CinetPay payment whose webhook never arrived was never
 * re-checked at all — « Savon Noir Royal Cosmétik » (2026-09-14, session
 * pm_CePIUng4q, Côte d'Ivoire) sat as a draft asking the annonceur to pay again
 * while CinetPay itself answered code=100 SUCCESS.
 */
const RECONCILABLE = [PaymentGateway.FEEXPAY, PaymentGateway.MONEYFUSION, PaymentGateway.CINETPAY];

const MINUTES = 60 * 1000;

/**
 * How long to leave a payment alone before asking. The webhook usually arrives
 * within seconds; querying immediately would just race it.
 */
const MIN_AGE_MS = Number(process.env.PAYIN_RECONCILE_MIN_AGE_MIN || 10) * MINUTES;
/** How far back to look. Older than this, the provider has usually forgotten it. */
const MAX_AGE_MS = Number(process.env.PAYIN_RECONCILE_MAX_AGE_DAYS || 7) * 24 * 60 * MINUTES;
/** Intents per cycle. Bounded so a backlog is drained gradually, not in one burst. */
const BATCH = Number(process.env.PAYIN_RECONCILE_BATCH || 40);
/** Gap between provider calls, so we don't hammer them. */
const SPACING_MS = Number(process.env.PAYIN_RECONCILE_SPACING_MS || 300);

/**
 * How long before asking about the same payment again, by how many times the
 * provider has already answered "still nothing".
 *
 * Most PENDING_PROVIDER intents are abandoned checkouts — someone opened the
 * page and walked away — and those never resolve. Without a backoff the job
 * re-asks about the same recent few every single cycle and never reaches an
 * older payment that IS recoverable. Backing off the ones that keep answering
 * the same way is what lets the queue rotate.
 */
const backoffMs = (attempts: number): number =>
    attempts < 3 ? 10 * MINUTES
        : attempts < 10 ? 60 * MINUTES
            : 6 * 60 * MINUTES;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class PayinReconciler {
    private isRunning = false;
    private cronJob: ReturnType<typeof cron.schedule>;

    constructor() {
        this.cronJob = cron.schedule(
            process.env.PAYIN_RECONCILE_CRON || '*/10 * * * *',
            async () => { await this.reconcile(); },
            { name: 'payin-reconciler' },
        );
        this.cronJob.stop();
    }

    public start(): void {
        this.cronJob.start();
        log.info('Payin reconciler started');
    }

    public stop(): void {
        this.cronJob.stop();
        log.info('Payin reconciler stopped');
    }

    /**
     * One pass. Returns what it settled, so the reconcile script can report it.
     */
    public async reconcile(): Promise<{ checked: number; settled: number; failed: number; unresolved: number }> {
        if (this.isRunning) {
            log.warn('Payin reconciliation already running, skipping this cycle');
            return { checked: 0, settled: 0, failed: 0, unresolved: 0 };
        }
        this.isRunning = true;

        const now = Date.now();
        const result = { checked: 0, settled: 0, failed: 0, unresolved: 0 };

        try {
            const stuck = await PaymentIntentModel.find({
                status: { $in: [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING] },
                gateway: { $in: RECONCILABLE },
                gatewayPaymentId: { $exists: true, $nin: [null, ''] },
                createdAt: { $lte: new Date(now - MIN_AGE_MS), $gte: new Date(now - MAX_AGE_MS) },
                $or: [
                    { lastReconcileAt: { $exists: false } },
                    { lastReconcileAt: null },
                    { reconcileAttempts: { $lt: 3 }, lastReconcileAt: { $lte: new Date(now - backoffMs(0)) } },
                    { reconcileAttempts: { $gte: 3, $lt: 10 }, lastReconcileAt: { $lte: new Date(now - backoffMs(3)) } },
                    { reconcileAttempts: { $gte: 10 }, lastReconcileAt: { $lte: new Date(now - backoffMs(10)) } },
                ],
            })
                // Least recently asked about first, so the queue rotates instead of
                // the newest handful starving everything behind them.
                .sort({ lastReconcileAt: 1, createdAt: -1 })
                .limit(BATCH)
                .select('sessionId gateway gatewayPaymentId status amount currency createdAt reconcileAttempts');

            if (!stuck.length) return result;

            log.info(`Reconciling ${stuck.length} payment(s) the provider never told us about`);

            for (const intent of stuck) {
                result.checked++;
                try {
                    const settled = await this.reconcileIntent(intent);

                    if (settled === 'succeeded') {
                        result.settled++;
                        log.info(`Reconciled ${intent.sessionId} (${intent.gateway}): the payment HAD gone through`);
                    } else if (settled === 'failed') {
                        result.failed++;
                    } else {
                        result.unresolved++;
                    }

                    // The provider answered, so this one has genuinely been asked.
                    await this.stamp(intent._id, true);
                } catch (err) {
                    // Provider unreachable or erroring. Leave the intent's status
                    // alone and do NOT count the attempt — an outage must not back
                    // a real payment off exactly when it most needs checking. The
                    // timestamp still moves so the queue keeps rotating.
                    result.unresolved++;
                    await this.stamp(intent._id, false);
                    log.warn(`Could not reconcile ${intent.sessionId} (${intent.gateway}): ${(err as Error).message}`);
                }

                await sleep(SPACING_MS);
            }

            log.info(
                `Payin reconciliation: ${result.checked} checked, ${result.settled} settled as paid, `
                + `${result.failed} confirmed failed, ${result.unresolved} still unknown`,
            );
        } catch (err) {
            log.error('Payin reconciliation cycle failed:', err);
        } finally {
            this.isRunning = false;
        }

        return result;
    }

    /**
     * Records that we asked. `answered` is false when the provider itself failed
     * to respond, in which case the attempt does not count against the backoff.
     */
    private async stamp(id: unknown, answered: boolean): Promise<void> {
        await PaymentIntentModel.updateOne(
            { _id: id as never },
            {
                $set: { lastReconcileAt: new Date() },
                ...(answered ? { $inc: { reconcileAttempts: 1 } } : {}),
            },
        );
    }

    /**
     * FeexPay already has exactly the primitive this needs: the payin webhook
     * handler doesn't trust the payload either, it re-queries FeexPay and applies
     * the answer. Reusing it means reconciliation and the live webhook cannot
     * drift apart.
     */
    /**
     * Ask the provider about one intent and apply whatever it confirms.
     *
     * Public so the on-demand script goes through exactly the same dispatch as the
     * scheduled pass, rather than keeping its own (FeexPay-only) copy of it.
     */
    async reconcileIntent(intent: {
        sessionId: string;
        gateway: string;
        gatewayPaymentId?: string | null;
    }): Promise<'succeeded' | 'failed' | 'unknown'> {
        switch (intent.gateway) {
            case PaymentGateway.FEEXPAY:
                return this.reconcileFeexpay(intent.gatewayPaymentId as string);
            case PaymentGateway.MONEYFUSION:
                return this.reconcileMoneyFusion(intent.gatewayPaymentId as string);
            case PaymentGateway.CINETPAY:
                return this.reconcileCinetPay(intent.sessionId);
            default:
                // Explicit rather than a silent 'unknown': a gateway reaching here was
                // selected by the query but has no handler, which is a bug in this file.
                throw new Error(`No payin reconciler for gateway '${intent.gateway}'`);
        }
    }

    private async reconcileFeexpay(reference: string): Promise<'succeeded' | 'failed' | 'unknown'> {
        const intent = await paymentService.checkFeexpayTransactionStatus(reference);
        if (intent.status === PaymentStatus.SUCCEEDED) return 'succeeded';
        if (intent.status === PaymentStatus.FAILED) return 'failed';
        return 'unknown';
    }

    /**
     * MoneyFusion has no reconcile primitive, so this asks their status endpoint
     * and then replays the answer through the real webhook handler rather than
     * writing the intent itself — completion has side effects (subscriptions,
     * campaign settlement, referral commissions) that live in that path.
     */
    private async reconcileMoneyFusion(tokenPay: string): Promise<'succeeded' | 'failed' | 'unknown'> {
        const data = await moneyFusionService.checkPaymentStatus(tokenPay);
        if (!data) return 'unknown';

        const statut = String(data.statut ?? data.status ?? '').toLowerCase();
        const event = statut === 'paid' || statut === 'success' || statut === 'completed'
            ? 'payin.session.completed'
            : statut === 'failure' || statut === 'cancelled' || statut === 'no paid'
                ? 'payin.session.cancelled'
                : null;

        // Anything else is still in flight on their side. Say nothing.
        if (!event) return 'unknown';

        await paymentService.handleMoneyFusionPayinWebhook({ ...data, event, tokenPay });
        return event === 'payin.session.completed' ? 'succeeded' : 'failed';
    }

    /**
     * Replays CinetPay's notification through the real handler.
     *
     * Safe to replay because that handler trusts nothing in the payload: it looks
     * the intent up by our own session id, re-queries CinetPay's status API with
     * the stored payment token, and applies only what CinetPay answers — then runs
     * handlePaymentCompletion, which is what settles a campaign or activates a
     * subscription. No notify_token is sent, so the token comparison (which exists
     * to reject forged callbacks) is skipped; the status API call is the proof.
     */
    private async reconcileCinetPay(sessionId: string): Promise<'succeeded' | 'failed' | 'unknown'> {
        await paymentService.handleCinetPayWebhook({ merchant_transaction_id: sessionId });

        const after = await PaymentIntentModel.findOne({ sessionId }).select('status').lean();
        if (after?.status === PaymentStatus.SUCCEEDED) return 'succeeded';
        if (after?.status === PaymentStatus.FAILED) return 'failed';
        return 'unknown';
    }
}

export const payinReconciler = new PayinReconciler();
