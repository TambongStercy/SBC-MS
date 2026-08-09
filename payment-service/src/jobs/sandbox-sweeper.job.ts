import logger from '../utils/logger';
import PaymentIntentModel from '../database/models/PaymentIntent';
import TransactionModel, { TransactionStatus, TransactionType } from '../database/models/transaction.model';
import paymentIntentRepository from '../database/repositories/paymentIntent.repository';
import { PaymentStatus } from '../database/interfaces/IPaymentIntent';
import paymentService from '../services/payment.service';
import * as sandbox from '../services/sandbox.service';

const log = logger.getLogger('SandboxSweeper');

/**
 * Resolves sandbox payments the way a provider would: some time after
 * initiation, a "webhook" arrives.
 *
 * Everything the sweeper needs travels inside the SBX- reference (outcome +
 * due time), so it reads nothing but the database and survives restarts. It
 * deliberately funnels each resolution through the same code a real provider
 * hits — payins end with addWebhookEvent + handlePaymentCompletion, payouts go
 * through the provider's actual webhook processor — so the sandbox proves the
 * genuine paths, debit-on-success included, not a parallel imitation of them.
 *
 * 'hang' references are simply never touched. That is the point of them.
 */
class SandboxSweeper {
    private interval: NodeJS.Timeout | null = null;
    private running = false;

    start(): void {
        if (!sandbox.isSandboxActive() || this.interval) return;
        this.interval = setInterval(() => this.sweep(), 10_000);
        log.warn('Sandbox sweeper started — resolving simulated payments every 10s');
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async sweep(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.sweepPayins();
            await this.sweepPayouts();
        } catch (error: any) {
            log.error(`Sandbox sweep failed: ${error.message}`, error);
        } finally {
            this.running = false;
        }
    }

    private async sweepPayins(): Promise<void> {
        const intents = await PaymentIntentModel.find({
            gatewayPaymentId: { $regex: `^${sandbox.SBX_PREFIX}` },
            status: { $in: [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING] },
        }).limit(50);

        for (const intent of intents) {
            const parsed = sandbox.parseSandboxRef(intent.gatewayPaymentId!);
            if (!parsed || parsed.outcome === 'hang' || Date.now() < parsed.dueAt) continue;

            const newStatus = parsed.outcome === 'success' ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED;
            log.warn(`SANDBOX: resolving payin ${intent.sessionId} → ${newStatus}`);

            try {
                // The same two calls every provider webhook handler ends with.
                const updated = await paymentIntentRepository.addWebhookEvent(
                    intent.sessionId,
                    newStatus,
                    { sandbox: true, outcome: parsed.outcome, reference: intent.gatewayPaymentId },
                );
                if (updated) {
                    await paymentService.handlePaymentCompletion(updated);
                }
            } catch (error: any) {
                log.error(`SANDBOX: failed to resolve payin ${intent.sessionId}: ${error.message}`, error);
            }
        }
    }

    private async sweepPayouts(): Promise<void> {
        const transactions = await TransactionModel.find({
            type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.PROCESSING,
            externalTransactionId: { $regex: `^${sandbox.SBX_PREFIX}` },
        }).limit(50);

        for (const txn of transactions) {
            const ref = txn.externalTransactionId!;
            const parsed = sandbox.parseSandboxRef(ref);
            if (!parsed || parsed.outcome === 'hang' || Date.now() < parsed.dueAt) continue;

            const provider = txn.metadata?.selectedPayoutService
                || txn.serviceProvider
                || txn.metadata?.serviceProvider; // crypto payouts store it here
            log.warn(`SANDBOX: resolving ${provider} payout ${txn.transactionId} → ${parsed.outcome}`);

            try {
                // Route through the provider's real webhook processor so
                // debit-on-success is the genuine article, not a re-implementation.
                if (provider === 'FeexPay') {
                    await paymentService.processFeexPayPayoutWebhook({
                        reference: ref,
                        amount: txn.metadata?.netAmountRequested ?? Math.abs(txn.amount),
                        status: parsed.outcome === 'success' ? 'SUCCESSFUL' : 'FAILED',
                        message: `SANDBOX ${parsed.outcome}`,
                        callback_info: { client_transaction_id: txn.transactionId, userId: String(txn.userId) },
                    });
                } else if (provider === 'MoneyFusion') {
                    await paymentService.handleMoneyFusionPayoutWebhook({
                        event: parsed.outcome === 'success' ? 'payout.session.completed' : 'payout.session.cancelled',
                        tokenPay: ref,
                    });
                } else if (provider === 'CinetPay') {
                    // Its handler re-verifies via checkPayoutStatus, which the
                    // sandbox stub answers from the reference itself.
                    await paymentService.processConfirmedPayoutWebhook(
                        txn.transactionId,
                        `SANDBOX ${parsed.outcome}`,
                        {
                            merchant_transaction_id: txn.transactionId,
                            transaction_id: ref,
                            notify_token: 'sandbox',
                            sandbox: true,
                        },
                    );
                } else if (String(provider).toLowerCase() === 'nowpayments') {
                    await paymentService.handleNowPaymentsPayoutWebhook({
                        id: ref,
                        status: parsed.outcome === 'success' ? 'finished' : 'failed',
                        address: txn.metadata?.cryptoAddress || 'sandbox',
                        currency: String(txn.currency || 'usd').toLowerCase(),
                        amount: String(Math.abs(txn.amount)),
                        batch_withdrawal_id: 'sandbox',
                    });
                } else {
                    log.error(`SANDBOX: unknown payout provider "${provider}" for ${txn.transactionId} — leaving untouched`);
                }
            } catch (error: any) {
                log.error(`SANDBOX: failed to resolve payout ${txn.transactionId}: ${error.message}`, error);
            }
        }
    }
}

export const sandboxSweeper = new SandboxSweeper();
export default sandboxSweeper;
