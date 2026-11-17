import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkBadge01Icon, Megaphone01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Button, EmptyState, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../components/ui';
import { DateText, ErrorState, FilterSelect, Money, StatusBadge, count, formatNumber, useUrlFilters } from '../components/moduleKit';
import type { AdsCampaign, CampaignStatus } from '../api/adsNetwork';
import { countryOnly, fetchAdsCampaigns } from '../components/adsNetwork/api';
import { ALL_CAMPAIGN_STATUSES, CAMPAIGN_STATUS } from '../components/adsNetwork/labels';
import { CampaignDetailSheet, ProgressBar } from '../components/adsNetwork/CampaignDetailSheet';

const PAGE_SIZE = 20;
const SHARED_KEYS = ['pays', 'periode', 'du', 'au'];
const KEYS = ['statut'] as const;

/**
 * Every campaign, any status (the test campaign has its own page). Country =
 * the annonceur's, period = creation date. A row opens the campaign's details
 * and per-diffuseur performance.
 */
export default function AdsNetworkCampaignsPage() {
  const filters = usePageFilters();
  const own = useUrlFilters(KEYS);
  const status = own.values.statut as CampaignStatus | '';
  const [open, setOpen] = useState<AdsCampaign | null>(null);

  const list = useQuery({
    queryKey: ['ads', 'campaigns', own.page, status, filters.apiParams],
    // No status means "review queue only" server-side, so "all" names every status.
    queryFn: () => fetchAdsCampaigns({ page: own.page, limit: PAGE_SIZE, status: status || ALL_CAMPAIGN_STATUSES }, filters.apiParams),
    placeholderData: prev => prev,
  });
  const queueScope = countryOnly(filters.apiParams);
  const pending = useQuery({ queryKey: ['ads', 'queue', 'campaigns', queueScope], queryFn: () => fetchAdsCampaigns({ page: 1, limit: 1 }, queueScope) });
  const pendingCount = pending.data?.pagination.total ?? 0;

  const columns: ListColumn<AdsCampaign>[] = [
    {
      key: 'title', header: 'Campagne', cell: c => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{c.title}</p>
          <p className="truncate text-xs text-fg-muted">{c.advertiser?.name || 'Annonceur inconnu'}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Statut', cell: c => <StatusBadge status={c.status} map={CAMPAIGN_STATUS} /> },
    { key: 'budget', header: 'Budget', numeric: true, cell: c => <Money value={c.amountPaid} /> },
    {
      key: 'progress', header: 'Vues livrées', className: 'w-56', cell: c => (
        <div className="w-full min-w-32 space-y-1 text-right md:text-left">
          <p className="text-sm tabular-nums text-fg">
            {formatNumber(c.progress.uniqueViewsDelivered)} / {formatNumber(c.progress.targetUniqueViews)}
            <span className="ml-1 text-xs text-fg-muted">{c.progress.percentComplete} %</span>
          </p>
          <ProgressBar value={c.progress.uniqueViewsDelivered} max={c.progress.targetUniqueViews} />
        </div>
      ),
    },
    { key: 'clicks', header: 'Clics', numeric: true, cell: c => formatNumber(c.clicksTotal) },
    { key: 'created', header: 'Créée', cell: c => <DateText value={c.createdAt} className="text-fg-muted" /> },
  ];

  const total = list.data?.pagination.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
       
        title="Campagnes"
        description="Toutes les campagnes des annonceurs, quel que soit leur statut. Ouvrez-en une pour voir sa diffusion par diffuseur."
        actions={(
          <>
          <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={() => void list.refetch()} loading={list.isFetching}>
            {!list.isFetching && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
          <Button variant={pendingCount > 0 ? 'primary' : 'outline'} size="lg" className="w-full sm:w-auto" asChild>
            <Link to="/ads-network/review">
              <HugeiconsIcon icon={CheckmarkBadge01Icon} size={18} aria-hidden="true" />
              {pendingCount > 0 ? `${formatNumber(pendingCount)} à valider` : 'File de validation'}
            </Link>
          </Button>
          </>
        )}
      />

      <PageFilters filters={filters} onReset={() => own.clear(SHARED_KEYS)}>
        <FilterSelect
          label="Statut"
          allLabel="Tous les statuts"
          value={status}
          onChange={v => own.set({ statut: v })}
          options={ALL_CAMPAIGN_STATUSES.map(s => ({ value: s, label: CAMPAIGN_STATUS[s][0] }))}
          className="sm:w-56"
        />
        {own.activeCount > 0 && !filters.isFiltered && (
          <Button variant="ghost" size="sm" className="h-11 self-start sm:h-9 sm:self-auto" onClick={() => own.clear()}>Effacer les filtres</Button>
        )}
      </PageFilters>

      <Panel>
        <PanelHeader title="Liste des campagnes" description={list.data ? count(total, 'campagne') : undefined} />
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={list.data?.campaigns ?? []}
            columns={columns}
            rowKey={c => c._id}
            onRowClick={setOpen}
            loading={list.isLoading}
            empty={list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
            ) : (
              <EmptyState
                icon={Megaphone01Icon}
                title="Aucune campagne pour ces filtres"
                description="Changez le statut, le pays ou la période."
                action={(filters.isFiltered || own.activeCount > 0) ? <Button size="lg" onClick={() => own.clear(SHARED_KEYS)}>Effacer les filtres</Button> : undefined}
              />
            )}
          />
        </div>
        <Pagination page={own.page} totalPages={list.data?.pagination.pages ?? 1} total={total} pageSize={PAGE_SIZE} onPageChange={own.setPage} />
      </Panel>

      <CampaignDetailSheet campaign={open} onOpenChange={o => { if (!o) setOpen(null); }} />
    </div>
  );
}
