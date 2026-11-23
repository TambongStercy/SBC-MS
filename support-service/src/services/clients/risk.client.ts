import config from '../../config';
import { requireOk, serviceRequest } from './http';

/**
 * risk-service (Security plan Phase 4), internal only. Its member view: score,
 * decision, reasons (links and referral rules; live event rules with their
 * expiry), linked accounts, shared identifiers by their last 3 digits, recent
 * events (types, dates, tails) and the KYC level 1 result. Never a full number,
 * address or device.
 */
export interface RiskReason { rule: string; points: number; detail: string; at?: string; expiresAt?: string }
export interface RiskMemberView {
    userId: string; scored: boolean; score: number; decision: 'allow' | 'require_code' | 'hold';
    reasons: RiskReason[]; liveReasons?: RiskReason[]; structuralScore?: number;
    groupSize: number; linked: { userId: string; score: number; decision: string; country: string | null }[];
    identifiers: { kind: 'phone' | 'device'; uses: string[]; tail: string; count: number; hub: boolean }[];
    events?: { type: string; at: string; kind: string | null; amountXaf: number | null; numberTail: string | null }[];
    kyc: {
        level: number; score: number; band: 'low' | 'medium' | 'high'; reasons: string[]; signals: any; variantAccounts: number; checkedAt: string;
        /** KYC level 2 (flagged members only): services that know the address, Gravatar. */
        level2?: { found: string[]; asked: number; answered: number; gravatar: boolean | null; trigger: string | null; checkedAt: string; reasons: string[]; points: number } | null;
    } | null;
    scoredAt: string | null;
    release?: { at: string; by: { id: string; name: string } | null; reason: string | null; scoreAtRelease: number; endedAt: string | null; active: boolean } | null;
}

export const riskConnected = () => !!config.services.risk;

/** Support's approved release of a held member (blocking mode). */
export async function releaseRiskMember(input: { userId: string; reason: string; by: { id: string; name: string }; approvalId: string }) {
    if (!riskConnected()) return { ok: false, code: 'RISK_NOT_CONNECTED', message: 'Le moteur de fraude n’est pas relié au support.' };
    const r = await serviceRequest('risk', 'POST', `/api/risk/internal/members/${input.userId}/release`, { body: { reason: input.reason, by: input.by, approvalId: input.approvalId }, timeoutMs: 5000 });
    return { ok: r.ok, code: r.code, message: r.message, data: r.data };
}

export async function getRiskMember(userId: string): Promise<RiskMemberView | null> {
    if (!riskConnected()) return null;
    const r = await serviceRequest<RiskMemberView>('risk', 'GET', `/api/risk/internal/members/${userId}`, { timeoutMs: 3000 });
    return requireOk('risk', r) ?? null;
}
