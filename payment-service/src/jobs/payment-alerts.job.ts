import cron from 'node-cron';
import logger from '../utils/logger';
import PaymentIntentModel from '../database/models/PaymentIntent';
import PaymentAlertModel, { PaymentAlertKind } from '../database/models/PaymentAlert';
import { PaymentStatus } from '../database/interfaces/IPaymentIntent';
import notificationServiceClient from '../services/clients/notification.service.client';

const log = logger.getLogger('PaymentAlerts');

/**
 * Security plan Phase 10: alerts to the team (never to members) when
 * - a provider's success rate over the last hour falls below half its 7-day rate;
 * - "SBC code" failures spike (a bad deploy), overall;
 * - "Provider API" failures spike for one provider (an outage);
 * - failures from our side or the provider's spike for one country;
 * - too many payments created in the last 24 h are still waiting for their provider.
 *
 * Runs every 5 minutes on the last hour, from paymentintents (index {createdAt}).
 * Alerts are stored in `paymentalerts` (shown on the admin "Paiements" page) and
 * e-mailed once when they open to `PAYMENT_ALERT_EMAILS` (comma-separated; no
 * e-mail while it is empty). An alert closes by itself when its condition clears.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export const ALERT_SETTINGS = {
    /** Fewest attempts in the hour before a provider's rate is judged. */
    minAttempts: num(process.env.PAYMENT_ALERT_MIN_ATTEMPTS, 20),
    /** Fewest failures in the hour for a spike. */
    spikeMin: num(process.env.PAYMENT_ALERT_SPIKE_MIN, 10),
    /** A spike is this many times the hourly average of the last 7 days. */
    spikeFactor: num(process.env.PAYMENT_ALERT_SPIKE_FACTOR, 3),
    /** Payments created 2–24 h ago still waiting for their provider, per provider. */
    stuckThreshold: num(process.env.PAYMENT_ALERT_STUCK, 100),
};

const SUCCESS = [PaymentStatus.SUCCEEDED, PaymentStatus.CONFIRMED];
const FAILED = [PaymentStatus.FAILED, PaymentStatus.ERROR, PaymentStatus.EXPIRED, PaymentStatus.CANCELED];
const WAITING = [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING, PaymentStatus.WAITING_FOR_CRYPTO_DEPOSIT];

export interface AlertCondition {
    key: string;
    kind: PaymentAlertKind;
    gateway?: string;
    country?: string;
    title: string;
    details: Record<string, unknown>;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** The alert conditions true at `now`. Read-only. */
export async function detectAlerts(now: Date = new Date(), s = ALERT_SETTINGS): Promise<AlertCondition[]> {
    const t = now.getTime();
    const weekStart = new Date(t - 7 * 24 * HOUR);
    // Success needs a few minutes: the "last hour" for rates is [now-75 min, now-15 min].
    const rateFrom = new Date(t - 75 * MIN);
    const rateTo = new Date(t - 15 * MIN);
    const hourAgo = new Date(t - HOUR);
    const baselineHours = (t - HOUR - weekStart.getTime()) / HOUR;

    const failureFacet = (by: Record<string, unknown>, groups: string[], recent: boolean) => ([
        { $match: { status: { $in: FAILED }, 'failure.group': { $in: groups }, 'failure.at': recent ? { $gte: hourAgo } : { $lt: hourAgo } } },
        { $group: { _id: by, count: { $sum: 1 } } },
    ]);

    const [out] = await PaymentIntentModel.aggregate([
        { $match: { createdAt: { $gte: weekStart, $lte: now } } },
        { $project: { status: 1, gateway: 1, countryCode: 1, failure: 1, createdAt: 1 } },
        {
            $facet: {
                rateRecent: [
                    { $match: { gateway: { $nin: [null, 'none'] }, createdAt: { $gte: rateFrom, $lt: rateTo } } },
                    { $group: { _id: '$gateway', attempts: { $sum: 1 }, succeeded: { $sum: { $cond: [{ $in: ['$status', SUCCESS] }, 1, 0] } } } },
                ],
                rateBase: [
                    { $match: { gateway: { $nin: [null, 'none'] }, createdAt: { $lt: rateFrom } } },
                    { $group: { _id: '$gateway', attempts: { $sum: 1 }, succeeded: { $sum: { $cond: [{ $in: ['$status', SUCCESS] }, 1, 0] } } } },
                ],
                sbcRecent: failureFacet({ $literal: 'all' } as any, ['sbc_code'], true),
                sbcBase: failureFacet({ $literal: 'all' } as any, ['sbc_code'], false),
                providerRecent: failureFacet('$gateway' as any, ['provider_api'], true),
                providerBase: failureFacet('$gateway' as any, ['provider_api'], false),
                countryRecent: failureFacet('$countryCode' as any, ['sbc_code', 'provider_api'], true),
                countryBase: failureFacet('$countryCode' as any, ['sbc_code', 'provider_api'], false),
                stuck: [
                    { $match: { status: { $in: WAITING }, createdAt: { $gte: new Date(t - 24 * HOUR), $lt: new Date(t - 2 * HOUR) } } },
                    { $group: { _id: '$gateway', count: { $sum: 1 } } },
                ],
            },
        },
    ]).allowDiskUse(true);

    const conditions: AlertCondition[] = [];
    const byId = (rows: any[]) => new Map<string, any>(rows.map(r => [String(r._id ?? 'none'), r]));

    // 1. Provider success rate below half its 7-day rate.
    const base = byId(out.rateBase);
    for (const r of out.rateRecent) {
        const b = base.get(String(r._id));
        if (!b || r.attempts < s.minAttempts || b.attempts < s.minAttempts) continue;
        const recentRate = pct(r.succeeded, r.attempts);
        const baseRate = pct(b.succeeded, b.attempts);
        if (baseRate >= 5 && recentRate < baseRate / 2) {
            conditions.push({
                key: `provider_drop:${r._id}`, kind: 'provider_drop', gateway: String(r._id),
                title: `${r._id} : ${recentRate} % de réussite sur la dernière heure (moyenne 7 jours ${baseRate} %)`,
                details: { attempts: r.attempts, succeeded: r.succeeded, recentRate, baseRate },
            });
        }
    }

    // 2–4. Spikes against the hourly average of the last 7 days.
    const spikes = (recent: any[], baseRows: any[], make: (id: string, count: number, avg: number) => AlertCondition) => {
        const b = byId(baseRows);
        for (const r of recent) {
            const id = String(r._id ?? 'none');
            const avg = (b.get(id)?.count ?? 0) / Math.max(baselineHours, 1);
            if (r.count >= s.spikeMin && r.count >= s.spikeFactor * avg) conditions.push(make(id, r.count, Math.round(avg * 10) / 10));
        }
    };
    spikes(out.sbcRecent, out.sbcBase, (_id, count, avg) => ({
        key: 'sbc_code_spike', kind: 'sbc_code_spike',
        title: `${count} échecs « code SBC » sur la dernière heure (moyenne ${avg}/h) : vérifier le dernier déploiement`,
        details: { count, hourlyAverage: avg },
    }));
    spikes(out.providerRecent, out.providerBase, (gw, count, avg) => ({
        key: `provider_api_spike:${gw}`, kind: 'provider_api_spike', gateway: gw,
        title: `${gw} : ${count} erreurs du prestataire sur la dernière heure (moyenne ${avg}/h)`,
        details: { count, hourlyAverage: avg },
    }));
    spikes(out.countryRecent, out.countryBase, (cc, count, avg) => ({
        key: `country_error_spike:${cc}`, kind: 'country_error_spike', country: cc,
        title: `${cc} : ${count} échecs (code SBC ou prestataire) sur la dernière heure (moyenne ${avg}/h)`,
        details: { count, hourlyAverage: avg },
    }));

    // 5. Stuck payments.
    for (const r of out.stuck) {
        if (r.count >= s.stuckThreshold) {
            conditions.push({
                key: `stuck_payments:${r._id}`, kind: 'stuck_payments', gateway: String(r._id),
                title: `${r._id} : ${r.count} paiements des dernières 24 h toujours en attente du prestataire après 2 h`,
                details: { count: r.count, threshold: s.stuckThreshold },
            });
        }
    }
    return conditions;
}

/** Opens new alerts, refreshes open ones, closes cleared ones. Returns the newly opened. */
export async function applyAlerts(conditions: AlertCondition[], now: Date = new Date()) {
    const opened: AlertCondition[] = [];
    for (const c of conditions) {
        const existing = await PaymentAlertModel.findOneAndUpdate(
            { key: c.key, open: true },
            { $set: { lastSeenAt: now, title: c.title, details: c.details } },
        );
        if (existing) continue;
        try {
            await PaymentAlertModel.create({ ...c, openedAt: now, lastSeenAt: now, open: true });
            opened.push(c);
        } catch (e: any) {
            if (e?.code !== 11000) throw e; // another process opened it first
        }
    }
    const keys = conditions.map(c => c.key);
    const closed = await PaymentAlertModel.updateMany({ open: true, key: { $nin: keys } }, { $set: { open: false, resolvedAt: now } });
    return { opened, closed: closed.modifiedCount };
}

const recipients = () => String(process.env.PAYMENT_ALERT_EMAILS || '').split(',').map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+$/.test(x));

async function notify(opened: AlertCondition[], now: Date) {
    const to = recipients();
    if (!opened.length || !to.length) return;
    const subject = opened.length === 1 ? `Alerte paiements : ${opened[0].title}` : `Alerte paiements : ${opened.length} nouvelles alertes`;
    const body = [
        'Nouvelles alertes sur les paiements SBC :',
        '',
        ...opened.map(c => `• ${c.title}`),
        '',
        'Détails : page « Paiements (conversion) » de l\'admin.',
    ].join('\n');
    for (const r of to) await notificationServiceClient.sendSystemEmail(r, subject, body);
    await PaymentAlertModel.updateMany({ key: { $in: opened.map(c => c.key) }, open: true }, { $set: { notifiedAt: now } });
}

export async function runPaymentAlerts(now: Date = new Date()) {
    const conditions = await detectAlerts(now);
    const result = await applyAlerts(conditions, now);
    if (result.opened.length) log.warn(`Payment alerts opened: ${result.opened.map(c => c.key).join(', ')}`);
    await notify(result.opened, now);
    return result;
}

class PaymentAlertsJob {
    private task: ReturnType<typeof cron.schedule> | null = null;
    private running = false;

    start() {
        if (process.env.PAYMENT_ALERTS_ENABLED === 'false') {
            log.info('Payment alerts disabled (PAYMENT_ALERTS_ENABLED=false).');
            return;
        }
        this.task = cron.schedule('*/5 * * * *', async () => {
            if (this.running) return;
            this.running = true;
            try {
                await runPaymentAlerts();
            } catch (e: any) {
                log.error(`Payment alerts run failed: ${e?.message}`);
            } finally {
                this.running = false;
            }
        });
        log.info('Payment alerts scheduled every 5 minutes.');
    }

    stop() {
        this.task?.stop();
    }
}

export const paymentAlertsJob = new PaymentAlertsJob();
