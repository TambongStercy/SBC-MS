import config from '../config';
import logger from './logger';

const log = logger.getLogger('RiskEvent');

/**
 * Security plan Phases 4 (part 2) and 8: tells risk-service something happened
 * to a member. risk-service stores it (202) and handles it within seconds: fraud
 * rules (contact change then withdrawal, sign-up bursts, dormant account back,
 * ledger mismatch) and the KYC level 1 check of new or changed details.
 * Fire-and-forget with a 1 s budget: never awaited on the member's request,
 * never throws. A lost event costs a live rule only; the KYC nightly refresh
 * and the fraud engine's weekly rebuild re-read the databases anyway.
 * Off without RISK_SERVICE_URL, or with RISK_EVENTS_DISABLED=true
 * (KYC_HINTS_DISABLED=true, its former name, still works).
 *
 * Withdrawals and payments are not sent: risk-service reads them from the
 * payment database itself.
 */
export type RiskEventType = 'signup' | 'contact_change' | 'authenticator_change' | 'dormant_reactivated' | 'balance_mismatch';

const off = (name: string) => String(process.env[name] || '').toLowerCase() === 'true';

export function riskEvent(type: RiskEventType, userId: unknown, data: Record<string, unknown> = {}): void {
    const base = (process.env.RISK_SERVICE_URL || '').replace(/\/+$/, '');
    if (!base || off('RISK_EVENTS_DISABLED') || off('KYC_HINTS_DISABLED')) return;
    const id = String(userId ?? '');
    if (!/^[a-f0-9]{24}$/i.test(id)) return;
    void fetch(`${base}/api/risk/internal/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.services.serviceSecret}`, 'x-service-name': 'user-service' },
        body: JSON.stringify({ ...data, type, userId: id, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(1000),
    }).then((r) => {
        if (!r.ok) log.debug(`Risk event ${type} for ${id} answered ${r.status}`);
    }).catch((e) => log.debug(`Risk event ${type} for ${id} not sent: ${e?.name ?? e}`));
}
