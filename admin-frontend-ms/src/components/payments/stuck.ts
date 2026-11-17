import { useQuery } from '@tanstack/react-query';
import type { PendingWithdrawalsResponse, WithdrawalTransaction } from '../../services/adminWithdrawalApi';

export type StuckProvider = 'moneyfusion' | 'cinetpay';
export type Fetcher = (page: number, limit: number, search?: string, extra?: Record<string, string>) => Promise<PendingWithdrawalsResponse>;

/** Root key of every stuck-withdrawal query: invalidate it after an action to refresh lists and counts. */
export const STUCK_KEY = ['payments-stuck'] as const;

/** The provider reference of a payout (MoneyFusion tokenPay or CinetPay transfer id). */
export const providerRef = (tx: WithdrawalTransaction): string | undefined =>
  (tx as unknown as { externalTransactionId?: string }).externalTransactionId || tx.metadata?.moneyFusionTokenPay || undefined;

/**
 * How many withdrawals are stuck with a provider (one-row request; for counts
 * on the hub). Narrowed by country only: an old stuck withdrawal still needs
 * action, so the period never hides it from the count.
 */
export function useStuckCount(provider: StuckProvider, fetcher: Fetcher, country?: string) {
  return useQuery({
    queryKey: [...STUCK_KEY, provider, 'count', country ?? ''],
    queryFn: () => fetcher(1, 1, undefined, country ? { country } : {}),
    select: r => r.data.pagination.total,
    staleTime: 30_000,
  });
}

export const HOUR = 3600_000;

/** "moins d'1 h", "5 h", "9 j": how long something has been waiting. */
export function waitedFor(date?: string | null): string | null {
  if (!date) return null;
  const age = Date.now() - new Date(date).getTime();
  if (Number.isNaN(age)) return null;
  if (age < HOUR) return 'moins d’1 h';
  if (age < 24 * HOUR) return `${Math.floor(age / HOUR)} h`;
  return `${Math.floor(age / (24 * HOUR))} j`;
}
