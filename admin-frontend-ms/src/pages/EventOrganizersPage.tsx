import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, InformationCircleIcon, UserGroupIcon, ViewIcon } from '@hugeicons/core-free-icons';
import { approveOrganizer, listOrganizers, type AdminOrganizer, type OrganizerStatus } from '../api/event';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import {
  Button, Dialog, EmptyState, MenuItem, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Money, Notice, RowMenu, SheetSection, StatusBadge,
  formatDateTime, formatNumber, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import { ORGANIZER_STATUS, PAGE_SIZE } from '../components/event/shared';
import { TwoLines } from '../components/event/TwoLines';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'En attente' },
  { value: 'APPROVED', label: 'Approuvés' },
  { value: 'SUSPENDED', label: 'Suspendus' },
];

/**
 * Organisers: approve newcomers. There is no organiser suspension any more:
 * SBC accepts or refuses each event instead (Événements → « À valider »), so
 * one bad event never blocks an organiser's other events. Organisers suspended
 * before that change can still be reactivated here.
 */
export default function EventOrganizersPage() {
  const qc = useQueryClient();
  const f = useUrlFilters(['status'] as const);
  const filters = usePageFilters();
  const clearAll = useClearAll(['status']);
  /** Queues show everything pending whatever the period: country only. */
  const queueParams = filters.country ? { country: filters.country } : {};
  const status = f.values.status as OrganizerStatus | '';
  const [detail, setDetail] = useState<AdminOrganizer | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  const list = useQuery({
    queryKey: ['event', 'organizers', status, f.page, status === 'PENDING' ? queueParams : filters.apiParams],
    // the pending queue ignores the period
    queryFn: () => listOrganizers({ status: status || undefined, limit: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE, ...(status === 'PENDING' ? queueParams : filters.apiParams) }),
    placeholderData: keepPreviousData,
  });
  const pending = useQuery({ queryKey: ['event', 'organizers', 'PENDING', 'count', queueParams], queryFn: () => listOrganizers({ status: 'PENDING', limit: 1, ...queueParams }).then(r => r.total) });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const approve = (o: AdminOrganizer) => {
    const reactivate = o.status === 'SUSPENDED';
    setConfirm({
      title: `${reactivate ? 'Réactiver' : 'Approuver'} ${o.displayName} ?`,
      description: 'L’organisateur aura accès à son espace pour créer ses événements. Chacun sera soumis à la validation de SBC avant d’être mis en vente.',
      confirmLabel: reactivate ? 'Réactiver' : 'Approuver',
      tone: 'primary',
      onConfirm: async () => {
        await approveOrganizer(o._id);
        toast.success(reactivate ? 'Organisateur réactivé.' : 'Organisateur approuvé.');
        setDetail(null);
        void qc.invalidateQueries({ queryKey: ['event', 'organizers'] });
      },
    });
  };

  const approveButton = (o: AdminOrganizer, phone = false) => o.status !== 'APPROVED' && (
    <Can module="events" write>
      <Button variant="soft" size={phone ? 'lg' : 'sm'} className={phone ? 'w-full' : undefined} onClick={e => { e.stopPropagation(); approve(o); }}>
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
        {o.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver'}
      </Button>
    </Can>
  );

  const columns: ListColumn<AdminOrganizer>[] = [
    { key: 'name', header: 'Organisateur', cell: o => <TwoLines main={o.displayName} sub={[o.contactEmail, o.contactPhone].filter(Boolean).join(' · ') || undefined} /> },
    { key: 'status', header: 'Statut', cell: o => <StatusBadge status={o.status} map={ORGANIZER_STATUS} /> },
    { key: 'events', header: 'Événements publiés', numeric: true, cell: o => formatNumber(o.stats?.eventsPublished ?? 0) },
    { key: 'revenue', header: 'Ventes', numeric: true, cell: o => <Money value={o.stats?.grossRevenue ?? 0} /> },
    { key: 'created', header: 'Inscrit', cell: o => <DateText value={o.createdAt} className="text-fg-muted" /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
      cell: o => (
        <div className="flex items-center justify-end gap-1">
          {approveButton(o)}
          <RowMenu>
            <MenuItem onSelect={() => setDetail(o)}><HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />Voir la fiche</MenuItem>
          </RowMenu>
        </div>
      ),
    },
  ];

  const card = (o: AdminOrganizer) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <TwoLines main={o.displayName} sub={o.contactEmail || o.contactPhone} />
        <StatusBadge status={o.status} map={ORGANIZER_STATUS} />
      </div>
      <p className="text-sm text-fg-muted">{formatNumber(o.stats?.eventsPublished ?? 0)} événements publiés · <Money value={o.stats?.grossRevenue ?? 0} /></p>
      {approveButton(o, true)}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisateurs"
        description="Les comptes qui créent des événements. Approuvez les nouveaux venus ; chaque événement reste validé un par un."
      />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          filterCount={1}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={<FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => f.set({ status: v })} options={STATUS_OPTIONS} />}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} organisateur{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      {!!pending.data && status !== 'PENDING' && (
        <Notice tone="warning">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span><strong className="font-semibold">{formatNumber(pending.data)} organisateur{pending.data > 1 ? 's' : ''} en attente</strong> d’approbation.</span>
            <Button variant="soft" size="md" className="h-11 sm:h-9" onClick={() => f.set({ status: 'PENDING' })}>Voir les demandes</Button>
          </div>
        </Notice>
      )}

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={o => o._id}
            onRowClick={setDetail}
            card={card}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={UserGroupIcon} title={status === 'PENDING' ? 'Aucun organisateur en attente' : 'Aucun organisateur'}
                description={(f.activeCount || filters.isFiltered) ? 'Aucun organisateur ne correspond à ce filtre.' : 'Les membres qui ouvrent un espace organisateur apparaîtront ici.'}
                action={(f.activeCount || filters.isFiltered) ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined} />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Notice icon={InformationCircleIcon}>
        Il n’y a plus de suspension d’organisateur : SBC accepte ou refuse chaque événement envoyé (page Événements, filtre « À valider »).
        Un événement refusé ne bloque pas les autres événements de l’organisateur. Les organisateurs suspendus avant ce changement peuvent être réactivés ici.
      </Notice>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent
            title={detail.displayName}
            description={<StatusBadge status={detail.status} map={ORGANIZER_STATUS} />}
            footer={detail.status !== 'APPROVED' ? approveButton(detail, true) : undefined}
          >
            <div className="space-y-5">
              {detail.bio && <p className="whitespace-pre-wrap text-sm text-fg">{detail.bio}</p>}
              <SheetSection title="Contact">
                <DetailList items={[
                  ['E-mail', detail.contactEmail || '—'],
                  ['Téléphone', detail.contactPhone || '—'],
                  ['Compte SBC', <Link key="u" to={`/userpage/${detail.userId}`} className="text-primary hover:underline">Ouvrir la fiche membre</Link>],
                ]} />
              </SheetSection>
              <SheetSection title="Activité">
                <DetailList items={[
                  ['Événements publiés', formatNumber(detail.stats?.eventsPublished ?? 0)],
                  ['Billets vendus', formatNumber(detail.stats?.ticketsSold ?? 0)],
                  ['Ventes', <Money key="m" value={detail.stats?.grossRevenue ?? 0} />],
                ]} />
              </SheetSection>
              <SheetSection title="Historique">
                <DetailList items={[
                  ['Inscrit le', formatDateTime(detail.createdAt)],
                  !!detail.approvedAt && ['Approuvé le', formatDateTime(detail.approvedAt)],
                  !!detail.suspendedAt && ['Suspendu le', formatDateTime(detail.suspendedAt)],
                  ['Identifiant', <CopyId key="id" value={detail._id} />],
                ]} />
              </SheetSection>
            </div>
          </SheetContent>
        )}
      </Dialog>

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
