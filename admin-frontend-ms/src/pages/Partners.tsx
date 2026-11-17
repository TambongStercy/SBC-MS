import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Agreement01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import type { PartnerData } from '../services/adminUserApi';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { listPartnersFiltered, partnerSummary } from '../components/members/api';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatMoney, formatNumber } from '../components/common/format';
import {
  Badge, Button, EmptyState, Metric, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Skeleton, type ListColumn,
} from '../components/ui';
import { MemberIdentity } from '../components/members/shared';
import { useUrlFilters } from '../components/members/filters';

const PAGE_SIZE = 20;
const NO_FILTERS = [] as const;

const PackBadge = ({ pack }: { pack: PartnerData['pack'] }) =>
  pack === 'gold' ? <Badge tone="warning">Gold</Badge> : <Badge tone="neutral">Silver</Badge>;

const StateBadge = ({ active }: { active: boolean }) =>
  active ? <Badge tone="success">Actif</Badge> : <Badge tone="danger">Inactif</Badge>;

/**
 * Partenaires: members with a Silver or Gold partner pack and what it has
 * earned them. A partner pack is given or removed from the member's page.
 */
function Partners() {
  const navigate = useNavigate();
  const { page, setPage } = useUrlFilters(NO_FILTERS);

  const pageFilters = usePageFilters();
  const range = pageFilters.apiParams;

  const listQuery = useQuery({
    queryKey: ['admin-partners', range, page],
    queryFn: () => listPartnersFiltered(range, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
  const summaryQuery = useQuery({
    queryKey: ['admin-partners-summary', range],
    queryFn: () => partnerSummary(range),
    placeholderData: keepPreviousData,
  });

  const partners = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;
  const periodHint = pageFilters.period !== 'all' ? 'devenus partenaires sur la période' : undefined;
  const s = summaryQuery.data;
  const open = (p: PartnerData) => { if (p.user?._id) navigate(`/userpage/${p.user._id}`); };
  const stat = (v?: number) => (summaryQuery.isLoading ? <Skeleton className="h-7 w-16" /> : formatNumber(v));
  // A page number past the end (filters narrowed, old link): go to the last page.
  const lastPage = pagination?.totalPages ?? 0;
  useEffect(() => { if (lastPage > 0 && page > lastPage) setPage(lastPage); }, [lastPage, page, setPage]);

  const columns: ListColumn<PartnerData>[] = [
    { key: 'who', header: 'Partenaire', cell: p => <MemberIdentity name={p.user?.name} email={p.user?.email} avatar={p.user?.avatar} /> },
    { key: 'pack', header: 'Pack', cell: p => <PackBadge pack={p.pack} /> },
    { key: 'amount', header: 'Gains', numeric: true, cell: p => formatMoney(p.amount ?? 0, 'XAF') },
    { key: 'state', header: 'Statut', cell: p => <StateBadge active={p.isActive} /> },
    { key: 'since', header: 'Partenaire depuis', cell: p => <RelativeTime value={p.createdAt} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, hideOnCard: true, className: 'text-right',
      cell: p => (
        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); open(p); }} disabled={!p.user?._id}>
          <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" /> Voir la fiche
        </Button>
      ),
    },
  ];

  const card = (p: PartnerData) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <MemberIdentity name={p.user?.name} email={p.user?.email} avatar={p.user?.avatar} />
        <StateBadge active={p.isActive} />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <PackBadge pack={p.pack} />
        <span className="font-medium tabular-nums text-fg">{formatMoney(p.amount ?? 0, 'XAF')}</span>
      </div>
      <p className="text-xs text-fg-muted">Partenaire depuis <RelativeTime value={p.createdAt} /></p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partenaires"
        description="Les membres Silver et Gold et leurs gains. Le pack partenaire se donne ou se retire depuis la fiche du membre."
      />

      <PageFilters filters={pageFilters} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Partenaires actifs" value={stat(s?.totalActivePartners)} hint={periodHint} />
        <Metric label="Gold actifs" value={stat(s?.activeGoldPartners)} hint={periodHint} />
        <Metric label="Silver actifs" value={stat(s?.activeSilverPartners)} hint={periodHint} />
      </div>
      {summaryQuery.isError && (
        <p className="text-xs text-fg-muted">
          Les chiffres n’ont pas pu être chargés. <button className="underline" onClick={() => void summaryQuery.refetch()}>Réessayer</button>
        </p>
      )}

      <Panel>
        <PanelHeader
          title="Liste des partenaires"
          description={pagination ? `${formatNumber(pagination.totalCount)} partenaire${pagination.totalCount > 1 ? 's' : ''}` : undefined}
        />
        <div className={listQuery.isFetching && !listQuery.isLoading ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={partners}
            columns={columns}
            rowKey={p => p._id}
            onRowClick={open}
            card={card}
            loading={listQuery.isLoading}
            empty={listQuery.isError ? (
              <ErrorState description={(listQuery.error as Error)?.message} onRetry={() => void listQuery.refetch()} retrying={listQuery.isFetching} />
            ) : (
              <EmptyState
                icon={Agreement01Icon}
                title={pageFilters.isFiltered ? 'Aucun partenaire pour ce pays ou cette période' : 'Aucun partenaire'}
                description={pageFilters.isFiltered ? 'Changez de pays ou de période.' : 'Donnez un pack Silver ou Gold depuis la fiche d’un membre.'}
                action={pageFilters.isFiltered ? <Button size="lg" onClick={pageFilters.reset}>Effacer les filtres</Button> : undefined}
              />
            )}
          />
        </div>
        {pagination && (
          <Pagination
            page={pagination.currentPage || page}
            totalPages={pagination.totalPages}
            total={pagination.totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </Panel>
    </div>
  );
}

export default Partners;
