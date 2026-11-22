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
    kyc: { level: number; score: number; band: 'low' | 'medium' | 'high'; reasons: string[]; signals: any; variantAccounts: number; checkedAt: string } | null;
    scoredAt: string | null;
}

export const riskConnected = () => !!config.services.risk;

export async function getRiskMember(userId: string): Promise<RiskMemberView | null> {
    if (!riskConnected()) return null;
    const r = await serviceRequest<RiskMemberView>('risk', 'GET', `/api/risk/internal/members/${userId}`, { timeoutMs: 3000 });
    return requireOk('risk', r) ?? null;
}
