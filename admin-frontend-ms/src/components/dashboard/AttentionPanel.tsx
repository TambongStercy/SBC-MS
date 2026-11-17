import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon, ArrowRight01Icon, CheckmarkCircle02Icon, FavouriteIcon, Megaphone01Icon, MoneySend01Icon, Video01Icon,
} from '@hugeicons/core-free-icons';
import apiClient from '../../api/apiClient';
import { usePermission } from '../../hooks/usePermission';
import type { AdminModule } from '../../lib/permissions';
import { Button, Panel, PanelHeader, Skeleton } from '../ui';
import { formatNumber } from '../common/format';

interface QueueDef {
  id: string;
  module: AdminModule;
  label: string;
  /** Follows the count, singular then plural: "1 retrait à valider", "12 retraits à valider". */
  noun: [string, string];
  /** What the admin does to clear it. */
  action: string;
  to: string;
  icon: IconSvgElement;
  /** Count of pending items. `country` only: a queue ignores the period. */
  count: (country?: string) => Promise<number>;
  hint?: string;
}

const params = (country?: string, extra: Record<string, unknown> = {}) => ({ params: { ...extra, ...(country ? { country } : {}) } });
const total = (body: { data?: { pagination?: { total?: number } }; pagination?: { total?: number } }) =>
  Number(body?.data?.pagination?.total ?? body?.pagination?.total ?? 0);

/**
 * Every queue the home page watches (existing endpoints only). Each one is
 * shown only to accounts that can read its module.
 */
const QUEUES: QueueDef[] = [
  {
    id: 'withdrawals', module: 'withdrawals', label: 'Retraits à valider', noun: ['retrait à valider', 'retraits à valider'], action: 'Valider', to: '/withdrawals/approvals', icon: MoneySend01Icon,
    count: async c => Number((await apiClient.get('/payments/admin/withdrawals/stats', params(c))).data?.data?.pendingApproval ?? 0),
  },
  {
    id: 'mf', module: 'payments', label: 'Retraits bloqués chez MoneyFusion', noun: ['retrait bloqué chez MoneyFusion', 'retraits bloqués chez MoneyFusion'], action: 'Vérifier', to: '/fix-moneyfusion-withdrawals', icon: Alert02Icon,
    hint: 'À vérifier sur le tableau de bord MoneyFusion, puis marquer payé ou échoué.',
    count: async c => total((await apiClient.get('/payments/admin/withdrawals/stuck-moneyfusion', params(c, { page: 1, limit: 1 }))).data),
  },
  {
    id: 'cinetpay', module: 'payments', label: 'Retraits bloqués chez CinetPay', noun: ['retrait bloqué chez CinetPay', 'retraits bloqués chez CinetPay'], action: 'Vérifier', to: '/fix-cinetpay-withdrawals', icon: Alert02Icon,
    hint: 'Un clic interroge CinetPay et applique sa réponse.',
    count: async c => total((await apiClient.get('/payments/admin/withdrawals/stuck-cinetpay', params(c, { page: 1, limit: 1 }))).data),
  },
  {
    id: 'ads', module: 'ads', label: 'Campagnes Ads à valider', noun: ['campagne ou visuel Ads à valider', 'campagnes ou visuels Ads à valider'], action: 'Examiner', to: '/ads-network/review', icon: Megaphone01Icon,
    count: async c => {
      const [campaigns, media] = await Promise.all([
        apiClient.get('/advertising/admin/campaigns', params(c, { page: 1, limit: 1 })),
        apiClient.get('/advertising/admin/media-changes', params(c)),
      ]);
      return total(campaigns.data) + (Array.isArray(media.data?.data) ? media.data.data.length : 0);
    },
  },
  {
    id: 'proofs', module: 'adsProofs', label: 'Preuves vidéo à vérifier', noun: ['preuve vidéo à vérifier', 'preuves vidéo à vérifier'], action: 'Vérifier', to: '/ads-network/manual-verifications', icon: Video01Icon,
    count: async c => {
      const list = (await apiClient.get('/advertising/admin/manual-verifications', params(c))).data?.data;
      return Array.isArray(list) ? list.length : 0;
    },
  },
  {
    id: 'sbclove', module: 'sbclove', label: 'SBC Love : profils et signalements', noun: ['profil ou signalement SBC Love', 'profils ou signalements SBC Love'], action: 'Modérer', to: '/sbclove', icon: FavouriteIcon,
    count: async c => {
      const s = (await apiClient.get('/sbclove/admin/stats', params(c))).data?.data;
      return Number(s?.profiles?.pending ?? 0) + Number(s?.reports?.open ?? 0);
    },
  },
];

/** The modules this account can read, in a stable hook order. */
function useReadable(): Set<AdminModule> {
  const w = usePermission('withdrawals');
  const p = usePermission('payments');
  const a = usePermission('ads');
  const v = usePermission('adsProofs');
  const l = usePermission('sbclove');
  const set = new Set<AdminModule>();
  if (w !== 'none') set.add('withdrawals');
  if (p !== 'none') set.add('payments');
  if (a !== 'none') set.add('ads');
  if (v !== 'none') set.add('adsProofs');
  if (l !== 'none') set.add('sbclove');
  return set;
}

/**
 * "À traiter": what needs someone today, first on the home page. Counts
 * follow the country filter but never the period (an old item still waits).
 */
export function AttentionPanel({ country }: { country?: string }) {
  const readable = useReadable();
  const queues = QUEUES.filter(q => readable.has(q.module));
  const results = useQueries({
    queries: queues.map(q => ({
      queryKey: ['dashboard-queue', q.id, country ?? ''],
      queryFn: () => q.count(country),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  if (queues.length === 0) return null;

  const rows = queues.map((q, i) => ({ q, r: results[i] }));
  const loading = rows.some(({ r }) => r.isLoading);
  const pending = rows.filter(({ r }) => (r.data ?? 0) > 0);
  const failed = rows.filter(({ r }) => r.isError);
  const clear = rows.filter(({ r }) => r.isSuccess && r.data === 0);
  const totalPending = pending.reduce((s, { r }) => s + (r.data ?? 0), 0);

  return (
    <Panel>
      <PanelHeader
        title="À traiter"
        description={loading ? 'Comptage en cours…' : totalPending > 0
          ? `${formatNumber(totalPending)} élément${totalPending > 1 ? 's' : ''} en attente, toutes dates confondues.`
          : 'Les files d’attente que vous suivez.'}
      />
      {loading && pending.length === 0 ? (
        <div className="space-y-2 px-5 pb-5">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : (
        <div className="pb-2">
          {pending.length === 0 && failed.length === 0 && (
            <p className="flex items-center gap-2 px-5 pb-3 text-sm text-fg-muted">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="text-success" aria-hidden="true" />
              Rien en attente. Tout est traité.
            </p>
          )}
          <ul className="divide-y divide-line border-t border-line">
            {pending.map(({ q, r }) => (
              <li key={q.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning" aria-hidden="true">
                  <HugeiconsIcon icon={q.icon} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">
                    <span className="mr-1.5 text-lg font-semibold">{formatNumber(r.data)}</span>
                    {q.noun[(r.data ?? 0) > 1 ? 1 : 0]}
                  </p>
                  {q.hint && <p className="text-xs text-fg-muted">{q.hint}</p>}
                </div>
                <Button asChild variant="outline" className="h-11 shrink-0 sm:h-9">
                  <Link to={q.to}>
                    {q.action}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                  </Link>
                </Button>
              </li>
            ))}
            {failed.map(({ q, r }) => (
              <li key={q.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-muted" aria-hidden="true">
                  <HugeiconsIcon icon={q.icon} size={18} />
                </span>
                <p className="min-w-0 flex-1 text-sm text-fg-muted">{q.label} : le nombre n’a pas pu être chargé.</p>
                <Button variant="ghost" className="h-11 shrink-0 sm:h-9" onClick={() => void r.refetch()}>Réessayer</Button>
              </li>
            ))}
          </ul>
          {clear.length > 0 && (
            <p className="border-t border-line px-5 pt-3 pb-1 text-xs text-fg-muted">
              Rien en attente : {clear.map(({ q }) => q.label).join(' · ')}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
