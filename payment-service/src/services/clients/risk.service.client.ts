import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('RiskServiceClient');

/**
 * Security plan Phase 4: asks risk-service (POST /api/risk/internal/decision)
 * whether money may leave a member's balance.
 *
 * RISK_MODE (payment-service .env):
 *   off      (default) never asked.
 *   silent   asked with a 100 ms budget, the answer is only logged (risk-service
 *            keeps every question in `decisionlogs`), nothing is ever refused.
 *   enforce  (decided 2026-11-22) a member the engine marks `hold` cannot take
 *            money out until support releases them; `require_code` passes (the
 *            authenticator code is already asked). Asked with RISK_ENFORCE_TIMEOUT_MS
 *            (1500); no answer = refused too (never paid blind), unless
 *            RISK_FAIL_OPEN=true.
 * askRisk never throws; the caller decides.
 */
export interface RiskAnswer { decision: 'allow' | 'require_code' | 'hold'; score: number; reasons: { rule: string; points: number; detail: string }[]; released?: boolean }

export type RiskMode = 'off' | 'silent' | 'enforce';
export const riskMode = (): RiskMode => {
    const m = String(process.env.RISK_MODE || 'off').toLowerCase();
    return m === 'enforce' ? 'enforce' : m === 'silent' ? 'silent' : 'off';
};
export const riskEnforceTimeoutMs = () => Math.min(Math.max(Number(process.env.RISK_ENFORCE_TIMEOUT_MS) || 1500, 100), 10_000);
export const riskFailOpen = () => String(process.env.RISK_FAIL_OPEN || '').toLowerCase() === 'true';
const riskUrl = () => String(process.env.RISK_SERVICE_URL || '').replace(/\/+$/, '');

export async function askRisk(input: { userId: string; action: string; amount?: number; currency?: string; transactionId?: string; enforced?: boolean }, timeoutMs = 100): Promise<RiskAnswer | null> {
    if (riskMode() === 'off' || !riskUrl()) return null;
    try {
        const res = await axios.post(`${riskUrl()}/api/risk/internal/decision`, input, {
            timeout: timeoutMs,
            headers: { Authorization: `Bearer ${config.services.serviceSecret}`, 'x-service-name': 'payment-service' },
        });
        return res.data?.data ?? null;
    } catch (error: any) {
        log.warn(`Risk decision unavailable for user ${input.userId}: ${error.code || error.response?.status || error.message}`);
        return null;
    }
}

/**
 * Security plan Phase 4, part 2: tells risk-service about something only
 * payment-service sees (the ledger triple check disagreeing). Fire-and-forget,
 * 1 s budget, never awaited, never throws; sent whenever RISK_MODE is not off.
 * Withdrawals and payments are NOT sent: risk-service reads them from the
 * payment database itself.
 */
export function riskEvent(type: 'balance_mismatch', userId: string, data: Record<string, unknown> = {}): void {
    if (riskMode() === 'off' || !riskUrl() || !/^[a-f0-9]{24}$/i.test(userId)) return;
    axios.post(`${riskUrl()}/api/risk/internal/events`, { ...data, type, userId }, {
        timeout: 1000,
        headers: { Authorization: `Bearer ${config.services.serviceSecret}`, 'x-service-name': 'payment-service' },
    }).catch((error: any) => log.debug(`Risk event ${type} for ${userId} not sent: ${error.code || error.response?.status || error.message}`));
}
