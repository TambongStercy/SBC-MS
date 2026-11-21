import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('RiskServiceClient');

/**
 * Security plan Phase 4: asks risk-service (POST /api/risk/internal/decision)
 * whether money may leave a member's balance.
 *
 * RISK_MODE (payment-service .env):
 *   off     (default) never asked.
 *   silent  asked with a 100 ms budget, the answer is only logged (risk-service
 *           keeps every question in `decisionlogs`), nothing is ever refused.
 * An `enforce` mode comes later, after the silent weeks and Rufus's rules for
 * a held withdrawal. Never throws.
 */
export interface RiskAnswer { decision: 'allow' | 'require_code' | 'hold'; score: number; reasons: { rule: string; points: number; detail: string }[] }

export const riskMode = (): 'off' | 'silent' => (String(process.env.RISK_MODE || 'off').toLowerCase() === 'silent' ? 'silent' : 'off');
const riskUrl = () => String(process.env.RISK_SERVICE_URL || '').replace(/\/+$/, '');

export async function askRisk(input: { userId: string; action: string; amount?: number; currency?: string; transactionId?: string }, timeoutMs = 100): Promise<RiskAnswer | null> {
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
