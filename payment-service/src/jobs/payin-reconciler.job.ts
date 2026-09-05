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

/** Gateways whose payin status can actually be queried. */
const RECONCILABLE = [PaymentGateway.FEEXPAY, PaymentGateway.MONEYFUSION];

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
            })
                .sort({ createdAt: -1 })  // newest first: a payer waiting right now matters more than one from last week
                .limit(BATCH)
                .select('sessionId gateway gatewayPaymentId status amount currency createdAt');

            if (!stuck.length) return result;

            log.info(`Reconciling ${stuck.length} payment(s) the provider never told us about`);

            for (const intent of stuck) {
                result.checked++;
                try {
                    const settled = intent.gateway === PaymentGateway.FEEXPAY
                        ? await this.reconcileFeexpay(intent.gatewayPaymentId as string)
                        : await this.reconcileMoneyFusion(intent.gatewayPaymentId as string);

                    if (settled === 'succeeded') {
                        result.settled++;
                        log.info(`Reconciled ${intent.sessionId} (${intent.gateway}): the payment HAD gone through`);
                    } else if (settled === 'failed') {
                        result.failed++;
                    } else {
                        result.unresolved++;
                    }
                } catch (err) {
                    // Provider unreachable or erroring. Leave the intent alone and
                    // try again next cycle — silence is not a failed payment.
                    result.unresolved++;
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
     * FeexPay already has exactly the primitive this needs: the payin webhook
     * handler doesn't trust the payload either, it re-queries FeexPay and applies
     * the answer. Reusing it means reconciliation and the live webhook cannot
     * drift apart.
     */
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
}

export const payinReconciler = new PayinReconciler();
