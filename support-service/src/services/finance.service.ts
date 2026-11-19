import { financeWithdrawals, regularizeWithdrawal } from './clients/payment.client';
import { registerExecutor } from './approval.service';
import { getSetting } from './settings.service';
import { upsertCase } from './case.service';
import { notifyAgents } from './notifier.service';
import logger from '../utils/logger';

const log = logger.getLogger('Finance');

// Regularisation (complete/fail a withdrawal), executed only after approval
// by a finance_manager. payment-service does the conditional transition.
registerExecutor('regularization', async (a) => {
    const p = a.payload as { transactionId: string; action: 'complete' | 'fail'; evidence: string[] };
    const r = await regularizeWithdrawal(p.transactionId, { action: p.action, reason: a.reason, evidence: p.evidence ?? [], approvalId: String(a._id) });
    if (r.ok) return { ok: true, result: r.data };
    const msg = r.code === 'STATE_CHANGED'
        ? 'Le retrait a changé d’état entre-temps : régularisation non appliquée. Revérifiez le retrait.'
        : r.message || 'Régularisation refusée par le service paiement.';
    return { ok: false, code: r.code ?? `HTTP_${r.status}`, message: msg };
});

const BUCKETS: { bucket: string; level: 0 | 1 | 2 }[] = [
    { bucket: '24-48h', level: 0 },
    { bucket: '48-72h', level: 1 },
    { bucket: '>72h', level: 2 },
];

/**
 * Withdrawals without a final answer: alert at the first threshold, case to
 * the finance manager at the second, critical at the third (finance.alertHours).
 * Funds are never released on a timeout. The age buckets come from
 * payment-service, which owns the data.
 */
export async function withdrawalAgeAlerts(): Promise<{ alerts: number; cases: number }> {
    const hours = await getSetting<number[]>('finance.alertHours');
    let alerts = 0, cases = 0;
    for (const { bucket, level } of BUCKETS) {
        let page = 1;
        for (;;) {
            const data: any = await financeWithdrawals({ status: 'non_final', ageBucket: bucket, page, limit: 100 });
            const items: any[] = Array.isArray(data) ? data : (data?.items ?? []);
            for (const w of items) {
                if (!w?.transactionId) continue;
                if (level === 0) {
                    await notifyAgents({
                        role: 'finance_agent', kind: 'withdrawal.age', title: `Retrait sans réponse depuis plus de ${hours[0]} h`,
                        body: `Retrait ${w.transactionId} : statut ${w.businessStatus ?? w.status}.`, link: `/finance/withdrawals/${w.transactionId}`,
                        dedupKey: `wage:${w.transactionId}:0`,
                    });
                    alerts++;
                } else {
                    await upsertCase({
                        type: 'unknown_status', dedupKey: `withdrawal:${w.transactionId}:unknown_status`,
                        severity: level === 2 ? 'critical' : 'warning',
                        summary: `Retrait sans réponse définitive depuis plus de ${hours[level]} h`,
                        subject: { userId: w.userId, transactionId: w.transactionId, gateway: w.gateway },
                    }, 'support-finance-job');
                    cases++;
                }
            }
            if (items.length < 100 || page >= 20) break;
            page++;
        }
    }
    log.info('withdrawal age alerts', { alerts, cases });
    return { alerts, cases };
}
