import cron, { type ScheduledTask } from 'node-cron';
import logger from '../utils/logger';
import TransactionModel, { ITransaction, TransactionStatus, TransactionType } from '../database/models/transaction.model';
import { userServiceClient } from '../services/clients/user.service.client';
import { openSupportCase, SupportCaseInput } from '../services/clients/support.service.client';
import { settleCompletedWithdrawal, releaseWithdrawalReservation } from '../services/withdrawal-lifecycle';

const log = logger.getLogger('FinanceReconciliation');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Daily withdrawal reconciliation (support phase 2, CdC §5). Read-mostly: it
 * opens support cases (idempotent dedupKey) and only ever retries the two
 * idempotent bookkeeping steps a crash may have skipped — settling a COMPLETED
 * withdrawal (ledger reference `withdrawal:<txId>`, debits once) and releasing
 * the reservation of a withdrawal that ended. It never releases money because
 * time passed: an unanswered withdrawal stays reserved and becomes a case.
 *
 *  unknown_status       PENDING/PROCESSING without final provider answer after 24 h
 *  debit_missing        COMPLETED (since `since`) with no `withdrawal:<txId>` debit — settled again
 *  withdrawal_divergence a `withdrawal:` debit whose transaction is not COMPLETED (debit without proof)
 *  duplicate_callback / amount_mismatch / paid-externally-but-pending are raised live by the handlers.
 */
export interface ReconciliationReport {
    unknownStatus: number;
    debitMissing: number;
    debitWithoutProof: number;
    releasesRetried: number;
}

export async function runFinanceReconciliation(now: Date = new Date(), sinceDays = 3): Promise<ReconciliationReport> {
    const report: ReconciliationReport = { unknownStatus: 0, debitMissing: 0, debitWithoutProof: 0, releasesRetried: 0 };
    const cases: SupportCaseInput[] = [];
    const since = new Date(now.getTime() - sinceDays * DAY);

    // 1. No final answer after 24 h (escalates with age; the case is created once).
    const stale = await TransactionModel.find({
        type: TransactionType.WITHDRAWAL,
        status: { $in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
        updatedAt: { $lt: new Date(now.getTime() - 24 * HOUR) },
        'metadata.adminDirectPayout': { $ne: true },
    }).select('transactionId userId createdAt status serviceProvider metadata.selectedPayoutService externalTransactionId').limit(1000).lean<ITransaction[]>();
    for (const tx of stale) {
        const ageH = Math.floor((now.getTime() - new Date(tx.createdAt).getTime()) / HOUR);
        report.unknownStatus++;
        cases.push({
            type: 'unknown_status', dedupKey: `withdrawal:${tx.transactionId}:unknown`,
            severity: ageH >= 72 ? 'critical' : 'warning',
            subject: { userId: tx.userId?.toString(), transactionId: tx.transactionId, gateway: tx.serviceProvider || tx.metadata?.selectedPayoutService },
            summary: `Retrait sans réponse finale du prestataire depuis ${ageH} h (fonds réservés, jamais libérés sur un simple délai).`,
            details: { status: tx.status, externalTransactionId: tx.externalTransactionId ?? null, ageHours: ageH },
        });
    }

    // 2. Success without debit: completed recently, no ledger debit. Settlement is idempotent.
    const completed = await TransactionModel.find({
        type: TransactionType.WITHDRAWAL, status: TransactionStatus.COMPLETED, updatedAt: { $gte: since },
        'metadata.adminDirectPayout': { $ne: true },
    }).limit(5000).lean<ITransaction[]>();
    for (let i = 0; i < completed.length; i += 400) {
        const chunk = completed.slice(i, i + 400);
        const found = new Set((await userServiceClient.lookupWalletMovements(chunk.map((t) => `withdrawal:${t.transactionId}`))).map((m) => m.reference));
        for (const tx of chunk) {
            if (found.has(`withdrawal:${tx.transactionId}`)) continue;
            // Before the ledger existed the debit left no movement; only withdrawals that carry
            // the reservation stamp (created after the release) or a failed-debit flag are checked.
            if (!tx.metadata?.reservation && !tx.metadata?.balanceUpdateFailed) continue;
            report.debitMissing++;
            await settleCompletedWithdrawal(tx, 'finance-reconciliation');
            cases.push({
                type: 'debit_missing', dedupKey: `withdrawal:${tx.transactionId}:debit-missing`, severity: 'critical',
                subject: { userId: tx.userId?.toString(), transactionId: tx.transactionId },
                summary: 'Retrait terminé sans débit du solde : le débit a été relancé (idempotent), vérifier le solde du membre.',
                details: { completedAt: tx.metadata?.payoutCompletedAt ?? null },
            });
        }
    }

    // 3. Debit without proof: a withdrawal debit whose transaction is not COMPLETED.
    const debits = await userServiceClient.listWalletMovements('withdrawal:', since);
    const ids = debits.filter((m) => m.direction === 'DEBIT').map((m) => m.reference.slice('withdrawal:'.length));
    if (ids.length) {
        const txs = await TransactionModel.find({ transactionId: { $in: ids } }).select('transactionId status userId').lean<ITransaction[]>();
        const byId = new Map(txs.map((t) => [t.transactionId, t]));
        for (const id of ids) {
            const tx = byId.get(id);
            if (tx?.status === TransactionStatus.COMPLETED) continue;
            report.debitWithoutProof++;
            cases.push({
                type: 'withdrawal_divergence', dedupKey: `withdrawal:${id}:divergence`, severity: 'critical',
                subject: { userId: tx?.userId?.toString(), transactionId: id },
                summary: `Solde débité pour un retrait qui n'est pas terminé (statut ${tx?.status ?? 'introuvable'}) : débit sans preuve.`,
                details: { status: tx?.status ?? null },
            });
        }
    }

    // 4. Ended withdrawals whose reservation was not released (user-service unreachable at the time).
    const ended = await TransactionModel.find({
        type: TransactionType.WITHDRAWAL,
        status: { $in: [TransactionStatus.FAILED, TransactionStatus.CANCELLED, TransactionStatus.REJECTED_BY_ADMIN, TransactionStatus.EXPIRED] },
        'metadata.reservation.state': 'held',
        updatedAt: { $gte: new Date(now.getTime() - 30 * DAY) },
    }).select('transactionId metadata').limit(1000).lean<ITransaction[]>();
    for (const tx of ended) {
        report.releasesRetried++;
        await releaseWithdrawalReservation(tx, 'reconciliation: ended withdrawal still reserved');
    }

    for (const c of cases) await openSupportCase(c);
    log.info(`Finance reconciliation: ${JSON.stringify(report)}`);
    return report;
}

class FinanceReconciliationJob {
    private task: ScheduledTask | null = null;
    private running = false;

    start(): void {
        if (process.env.FINANCE_RECONCILIATION_DISABLED === 'true') {
            log.warn('Finance reconciliation disabled (FINANCE_RECONCILIATION_DISABLED=true)');
            return;
        }
        this.task = cron.schedule('15 4 * * *', async () => {
            if (this.running) return;
            this.running = true;
            try {
                await runFinanceReconciliation();
            } catch (err: any) {
                log.error(`Finance reconciliation failed: ${err?.message ?? err}`);
            } finally {
                this.running = false;
            }
        }, { timezone: 'Africa/Douala' });
        log.info('Finance reconciliation scheduled (04:15 Africa/Douala)');
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const financeReconciliationJob = new FinanceReconciliationJob();
