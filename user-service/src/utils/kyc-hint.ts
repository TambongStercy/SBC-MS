import config from '../config';
import logger from './logger';

const log = logger.getLogger('KycHint');

/**
 * Security plan Phase 8: tells risk-service a member needs a KYC level 1 check
 * (new account, or a changed email / phone / MoMo number). Fire-and-forget with
 * a 1 s budget: never awaited on the member's request, never throws. A lost hint
 * only delays the check to the nightly refresh, which re-queues every member
 * whose details changed. Off without RISK_SERVICE_URL or with KYC_HINTS_DISABLED=true.
 */
export function kycHint(userId: unknown, reason: 'signup' | 'contact_change'): void {
    const base = (process.env.RISK_SERVICE_URL || '').replace(/\/+$/, '');
    if (!base || String(process.env.KYC_HINTS_DISABLED || '').toLowerCase() === 'true') return;
    const id = String(userId ?? '');
    if (!/^[a-f0-9]{24}$/i.test(id)) return;
    void fetch(`${base}/api/risk/internal/kyc/hint`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.services.serviceSecret}`, 'x-service-name': 'user-service' },
        body: JSON.stringify({ userId: id, reason }),
        signal: AbortSignal.timeout(1000),
    }).then((r) => {
        if (!r.ok) log.debug(`KYC hint for ${id} answered ${r.status}`);
    }).catch((e) => log.debug(`KYC hint for ${id} not sent: ${e?.name ?? e}`));
}
