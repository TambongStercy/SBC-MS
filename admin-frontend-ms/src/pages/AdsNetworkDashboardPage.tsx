import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkBadge01Icon, EyeIcon, Megaphone01Icon, RefreshIcon, Table01Icon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { usePermission } from '../hooks/usePermission';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import {
  Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Segmented, Skeleton, Table, TBody, TD, TH, THead, TR,
} from '../components/ui';
import {
  ErrorState, RankedBars, TodoAction, TodoPanel, TrendChart, formatCompactMoney, formatDelta, formatMoney, formatNumber, formatPercent,
  type TodoItem,
} from '../components/moduleKit';
import { countryOnly, fetchAdsAnalytics, fetchAdsCampaigns, fetchManualVerifications, fetchMediaChanges } from '../components/adsNetwork/api';
import { CAMPAIGN_STATUS } from '../components/adsNetwork/labels';

type History = '6' | '12' | '24';

/**
 * SBC Ads Network dashboard: what waits for a decision first, then the four
 * figures that matter (revenue, paid out, views, campaigns), the network's
 * size, and one chart per measure (by month, the service computes them).
 * Every figure follows the country + period filters; the queue counts follow
 * the country only.
 */
export default function AdsNetworkDashboardPage() {
  const filters = usePageFilters();
  const [params, setParams] = useSearchParams();
  const history = (['6', '12', '24'].includes(params.get('mois') ?? '') ? params.get('mois') : '12') as History;
  const setHistory = (h: History) => setParams(p => { const n = new URLSearchParams(p); if (h === '12') n.delete('mois'); else n.set('mois', h); return n; }, { replace: true });
  const [showTable, setShowTable] = useState(false);
  const proofsAccess = usePermission('adsProofs');
  const queueScope = countryOnly(filters.apiParams);

  const analytics = useQuery({
    queryKey: ['ads', 'analytics', history, filters.apiParams],
    queryFn: () => fetchAdsAnalytics(Number(history), filters.apiParams),
    placeholderData: prev => prev,
  });
  const toReview = useQuery({
    queryKey: ['ads', 'queue', 'campaigns', queueScope],
    queryFn: () => fetchAdsCampaigns({ page: 1, limit: 1 }, queueScope),
  });
  const mediaChanges = useQuery({ queryKey: ['ads', 'queue', 'media', queueScope], queryFn: () => fetchMediaChanges(queueScope) });
  const proofs = useQuery({
    queryKey: ['ads', 'queue', 'proofs', queueScope],
    queryFn: () => fetchManualVerifications(queueScope),
    enabled: proofsAccess !== 'none',
  });

  const data = analytics.data;
  const series = useMemo(() => data?.series ?? [], [data]);
  const lastTwo = series.length >= 2 ? [series[series.length - 2], series[series.length - 1]] : null;
  const periodAll = filters.period === 'all';

  const todo: TodoItem[] = [
    {
      key: 'campaigns',
      label: 'Campagnes payées à valider',
      hint: 'Rien n’est diffusé tant qu’elles ne sont pas validées ou refusées.',
      count: toReview.data?.pagination.total ?? 0,
      action: <TodoAction href="/ads-network/review">Valider</TodoAction>,
    },
    {
      key: 'media',
      label: 'Nouveaux visuels à valider',
      hint: 'Campagnes en diffusion dont l’annonceur propose un autre visuel.',
      count: mediaChanges.data?.length ?? 0,
      action: <TodoAction href="/ads-network/review#visuels">Comparer</TodoAction>,
    },
    ...(proofsAccess !== 'none' ? [{
      key: 'proofs',
      label: 'Preuves vidéo à vérifier',
      hint: 'Le diffuseur attend la validation de son jour pour être crédité.',
      count: proofs.data?.length ?? 0,
      action: <TodoAction href="/ads-network/manual-verifications">Vérifier</TodoAction>,
    } satisfies TodoItem] : []),
  ];

  const statusBars = data
    ? Object.entries(data.campaigns.byStatus ?? {})
      .filter(([, n]) => n > 0)
      .map(([s, n]) => ({ key: s, label: CAMPAIGN_STATUS[s]?.[0] ?? s, value: n }))
    : [];

  const point = (k: 'revenue' | 'views' | 'campaignsLaunched' | 'newDiffuseurs') => series.map(s => ({ date: s.month, value: s[k] }));

  return (
    <div className="space-y-6">
      <PageHeader
       
        title="SBC Ads Network"
        description="Les campagnes publicitaires diffusées sur les statuts WhatsApp : ce qui attend une décision, l’argent encaissé et versé, la diffusion."
        actions={(
          <>
            <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/ads-network/campaigns">Toutes les campagnes</Link>
            </Button>
            <Button variant="primary" size="lg" className="w-full sm:w-auto" asChild>
              <Link to="/ads-network/review">
                <HugeiconsIcon icon={CheckmarkBadge01Icon} size={18} aria-hidden="true" />
                Valider les campagnes
              </Link>
            </Button>
          </>
        )}
      />

      <TodoPanel items={todo} loading={toReview.isLoading || mediaChanges.isLoading} />

      <PageFilters filters={filters}>
        <Button variant="ghost" size="sm" className="h-11 sm:h-9 self-start sm:self-auto" onClick={() => void analytics.refetch()} loading={analytics.isFetching}>
          {!analytics.isFetching && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
          Actualiser
        </Button>
      </PageFilters>

      {analytics.isError && !data ? (
        <Panel><ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} retrying={analytics.isFetching} /></Panel>
      ) : (
        <div className={analytics.isFetching && data ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Chiffre d’affaires"
              icon={Wallet01Icon}
              tone="primary"
              value={data ? formatMoney(data.money.revenue) : <Skeleton className="h-8 w-32" />}
              hint={data && (
                <>
                  Marge brute {formatMoney(data.money.grossMargin)}
                  {periodAll && lastTwo && formatDelta(lastTwo[1].revenue, lastTwo[0].revenue) && (
                    <> · ce mois {formatDelta(lastTwo[1].revenue, lastTwo[0].revenue)}</>
                  )}
                </>
              )}
            />
            <Metric
              label="Versé aux diffuseurs"
              icon={Wallet01Icon}
              value={data ? formatMoney(data.money.paidToDiffuseurs) : <Skeleton className="h-8 w-32" />}
              hint={data && `${formatNumber(data.money.participationsPaid)} participations payées`}
            />
            <Metric
              label="Vues livrées"
              icon={EyeIcon}
              value={data ? formatNumber(data.delivery.totalViews) : <Skeleton className="h-8 w-24" />}
              hint={data && `${formatNumber(data.delivery.clicks)} clics · taux de clic ${formatPercent(data.delivery.totalViews ? data.delivery.clicks / data.delivery.totalViews : 0, 2)}`}
            />
            <Metric
              label="Campagnes créées"
              icon={Megaphone01Icon}
              value={data ? formatNumber(data.campaigns.total) : <Skeleton className="h-8 w-16" />}
              hint={data && `Ce mois : ${formatNumber(data.campaigns.launchedThisMonth)} lancées, ${formatNumber(data.campaigns.completedThisMonth)} terminées`}
            />
          </div>

          <Panel>
            <PanelHeader title="Le réseau" description="Annonceurs et diffuseurs de la période ; diffusions et offres en ce moment." />
            <PanelBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                {[
                  ['Annonceurs', data?.annonceurs.total, data && `+${formatNumber(data.annonceurs.newThisMonth)} ce mois`],
                  ['Diffuseurs', data?.diffuseurs.total, data && `+${formatNumber(data.diffuseurs.newThisMonth)} ce mois`],
                  ['Diffusions en cours', data?.pipeline.inProgress, 'en ce moment'],
                  ['Offres sans réponse', data?.pipeline.offered, 'en ce moment'],
                ].map(([label, value, hint]) => (
                  <div key={String(label)}>
                    <dt className="text-xs text-fg-muted">{label}</dt>
                    <dd className="mt-1 text-lg font-semibold text-fg">{value == null ? <Skeleton className="h-6 w-14" /> : formatNumber(value as number)}</dd>
                    <dd className="text-xs text-fg-subtle">{hint}</dd>
                  </div>
                ))}
              </dl>
            </PanelBody>
          </Panel>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-fg">Par mois</h2>
            <div className="flex flex-wrap items-center gap-2">
              {periodAll && (
                <Segmented label="Historique" size="sm" value={history} onValueChange={setHistory}
                  options={[{ value: '6', label: '6 mois' }, { value: '12', label: '12 mois' }, { value: '24', label: '24 mois' }]} />
              )}
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
                <HugeiconsIcon icon={Table01Icon} size={16} aria-hidden="true" />
                {showTable ? 'Masquer le tableau' : 'Toutes les données du mois'}
              </Button>
            </div>
          </div>

          {showTable && (
            <Panel>
              <Table>
                <THead>
                  <tr>
                    <TH>Mois</TH><TH numeric>Chiffre d’affaires</TH><TH numeric>Versé</TH><TH numeric>Campagnes</TH>
                    <TH numeric>Vues</TH><TH numeric>Clics</TH><TH numeric>Nouveaux diffuseurs</TH>
                  </tr>
                </THead>
                <TBody>
                  {[...series].reverse().map(s => (
                    <TR key={s.month}>
                      <TD className="capitalize">{new Date(`${s.month}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</TD>
                      <TD numeric>{formatMoney(s.revenue)}</TD>
                      <TD numeric>{formatMoney(s.paidToDiffuseurs)}</TD>
                      <TD numeric>{formatNumber(s.campaignsLaunched)}</TD>
                      <TD numeric>{formatNumber(s.views)}</TD>
                      <TD numeric>{formatNumber(s.clicks)}</TD>
                      <TD numeric>{formatNumber(s.newDiffuseurs)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Panel>
          )}

          {!data ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-72 w-full rounded-panel" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel><TrendChart title="Chiffre d’affaires" description="Campagnes payées, au mois de leur lancement" kind="money" points={point('revenue')} /></Panel>
              <Panel><TrendChart title="Vues livrées" description="Vues uniques et répétées" points={point('views')} /></Panel>
              <Panel><TrendChart title="Campagnes lancées" points={point('campaignsLaunched')} /></Panel>
              <Panel><TrendChart title="Nouveaux diffuseurs" points={point('newDiffuseurs')} /></Panel>
            </div>
          )}

          <Panel>
            <PanelHeader title="Campagnes par statut" description="Campagnes créées sur la période, du plus fréquent au plus rare." />
            <PanelBody>
              {data ? <RankedBars items={statusBars} emptyText="Aucune campagne sur la période." /> : <Skeleton className="h-40 w-full" />}
            </PanelBody>
          </Panel>
          {data && data.money.revenue > 0 && (
            <p className="text-xs text-fg-muted">
              Montants en francs CFA ({formatCompactMoney(data.money.revenue)} encaissés sur la période). Le chiffre d’affaires compte une campagne au mois où elle a été lancée.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
