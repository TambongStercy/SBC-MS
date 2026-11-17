import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Award01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import {
  Badge, Button, EmptyState, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Segmented, Switch, Tooltip, type ListColumn,
} from '../components/ui';
import { ErrorState, count, formatNumber, formatPercent, useUrlFilters } from '../components/moduleKit';
import type { LeaderboardEntry } from '../api/adsNetwork';
import { fetchLeaderboard } from '../components/adsNetwork/api';
import { getCountryName } from '../utils/countryUtils';

const PAGE_SIZE = 50;
const SHARED_KEYS = ['pays', 'periode', 'du', 'au'];
const KEYS = ['tri', 'mesurees'] as const;
type Sort = 'views' | 'clicks' | 'trust';

const trustTone = (score: number) => (score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger');

/**
 * Diffuseur ranking: reach, click-through and reliability side by side.
 * Country = the diffuseur's; period = when they joined the network.
 */
export default function AdsNetworkDiffuseursPage() {
  const filters = usePageFilters();
  const own = useUrlFilters(KEYS, { tri: 'views' });
  const sortBy = (['views', 'clicks', 'trust'].includes(own.values.tri) ? own.values.tri : 'views') as Sort;
  const measuredOnly = own.values.mesurees === '1';

  const list = useQuery({
    queryKey: ['ads', 'diffuseurs', own.page, sortBy, measuredOnly, filters.apiParams],
    queryFn: () => fetchLeaderboard({ page: own.page, limit: PAGE_SIZE, sortBy, measuredOnly }, filters.apiParams),
    placeholderData: prev => prev,
  });
  const entries = list.data?.entries ?? [];
  const total = list.data?.total ?? entries.length;
  const rankOf = (e: LeaderboardEntry) => (own.page - 1) * PAGE_SIZE + entries.indexOf(e) + 1;

  const columns: ListColumn<LeaderboardEntry>[] = [
    {
      key: 'who', header: 'Diffuseur', cell: e => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-fg-subtle">{rankOf(e)}</span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{e.name || e.userId}</p>
            <p className="truncate text-xs text-fg-muted">{[e.phoneNumber, e.country && getCountryName(e.country)].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'avg', header: 'Moyenne de vues', numeric: true, cell: e => (
        <span className="inline-flex items-center gap-2">
          {formatNumber(e.averageViews)}
          <Tooltip content={e.isMeasured ? 'Mesurée par la campagne test' : 'Déclarée par le diffuseur, pas encore mesurée'}>
            <span tabIndex={0}><Badge tone={e.isMeasured ? 'success' : 'neutral'}>{e.isMeasured ? 'mesurée' : 'déclarée'}</Badge></span>
          </Tooltip>
        </span>
      ),
    },
    { key: 'views', header: 'Vues vérifiées', numeric: true, cell: e => formatNumber(e.totalVerifiedViews) },
    { key: 'clicks', header: 'Clics', numeric: true, cell: e => <>{formatNumber(e.totalClicks)} <span className="text-xs text-fg-muted">({formatPercent(e.clickThroughRate, 2)})</span></> },
    { key: 'done', header: 'Campagnes', numeric: true, cell: e => formatNumber(e.campaignsCompleted) },
    { key: 'trust', header: 'Confiance', numeric: true, cell: e => <Badge tone={trustTone(e.trustScore)}>{e.trustScore} / 100</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
       
        title="Diffuseurs"
        description="Le classement des diffuseurs : audience, clics et fiabilité. Une moyenne « déclarée » n’engage que celui qui l’a écrite ; elle devient « mesurée » après la campagne test."
        actions={(
          <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => void list.refetch()} loading={list.isFetching}>
            {!list.isFetching && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
        )}
      />

      <PageFilters filters={filters} onReset={() => own.clear(SHARED_KEYS)}>
        <Segmented
          label="Trier par"
          size="lg"
          value={sortBy}
          onValueChange={v => own.set({ tri: v === 'views' ? '' : v })}
          options={[{ value: 'views', label: 'Vues' }, { value: 'clicks', label: 'Clics' }, { value: 'trust', label: 'Confiance' }]}
          className="self-start sm:self-auto sm:[&>button]:h-8"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm text-fg sm:min-h-9">
          <Switch checked={measuredOnly} onCheckedChange={v => own.set({ mesurees: v ? '1' : '' })} />
          Moyennes mesurées uniquement
        </label>
        {own.activeCount > 0 && !filters.isFiltered && (
          <Button variant="ghost" size="sm" className="h-11 self-start sm:h-9 sm:self-auto" onClick={() => own.clear()}>Effacer les filtres</Button>
        )}
      </PageFilters>

      <Panel>
        <PanelHeader title="Classement" description={list.data ? count(total, 'diffuseur') : undefined} />
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={entries}
            columns={columns}
            rowKey={e => e.userId}
            loading={list.isLoading}
            empty={list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
            ) : (
              <EmptyState icon={Award01Icon} title="Aucun diffuseur pour ces filtres" description="Les membres inscrits comme diffuseurs apparaissent ici." />
            )}
          />
        </div>
        <Pagination page={own.page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPageChange={own.setPage} />
      </Panel>
    </div>
  );
}
