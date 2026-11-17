import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Calendar03Icon, Cancel01Icon, CheckmarkCircle02Icon, PauseIcon, ViewIcon,
} from '@hugeicons/core-free-icons';
import {
  approveAdminEvent, cancelAdminEvent, listAdminEvents, rejectAdminEvent, suspendAdminEvent, type AdminEvent, type EventStatus,
} from '../api/event';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import { usePermission } from '../hooks/usePermission';
import {
  Badge, Button, Dialog, EmptyState, MenuItem, MenuSeparator, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Money, Notice, RowMenu, SearchInput, SheetSection, StatusBadge,
  formatDateTime, formatNumber, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import { EVENT_STATUS, PAGE_SIZE, eventPlace, isWebinaire } from '../components/event/shared';
import { TwoLines } from '../components/event/TwoLines';

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: 'PENDING_REVIEW', label: 'À valider' },
  { value: 'REJECTED', label: 'Refusés' },
  { value: 'DRAFT', label: 'Brouillons' },
  { value: 'PUBLISHED', label: 'En vente' },
  { value: 'SUSPENDED', label: 'Suspendus' },
  { value: 'CANCELLED', label: 'Annulés' },
  { value: 'COMPLETED', label: 'Passés' },
];

const REJECT_SUGGESTIONS = ['Informations incomplètes', 'Affiche ou description inappropriée', 'Date ou lieu incohérent', 'Lien WhatsApp manquant ou invalide'];
const REJECT_MIN = 5;
const canCancel = (s: EventStatus) => s !== 'CANCELLED' && s !== 'COMPLETED' && s !== 'PENDING_REVIEW' && s !== 'REJECTED';

/**
 * Every event. An event the organizer sends for review waits in « À valider »:
 * SBC accepts it (published, tickets on sale) or refuses it with a reason the
 * organizer sees; the organizer can then edit it and send it again. Refusing
 * never blocks the organizer's other events. Opens on « À valider » when events
 * wait for SBC's decision (`?status=` picks another filter, `?status=` absent
 * after « Tous les statuts » keeps every event).
 */
export default function EventListPage() {
  const qc = useQueryClient();
  const f = useUrlFilters(['status', 'q'] as const);
  const filters = usePageFilters();
  const clearAll = useClearAll(['status', 'q']);
  /** Queues show everything pending whatever the period: country only. */
  const queueParams = filters.country ? { country: filters.country } : {};
  // `?status=all` (older links) means every status
  const status = (f.values.status === 'all' ? '' : f.values.status) as EventStatus | '';
  const [detail, setDetail] = useState<AdminEvent | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const canWrite = usePermission('events') === 'write';

  const waiting = useQuery({
    queryKey: ['event', 'events', 'waiting', queueParams],
    queryFn: () => listAdminEvents({ status: 'PENDING_REVIEW', limit: 1, ...queueParams }).then(r => r.total),
  });
  // First visit without a status: open on « À valider » when something waits (once).
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || waiting.data === undefined) return;
    defaulted.current = true;
    if (!f.values.status && !f.values.q && waiting.data > 0) f.set({ status: 'PENDING_REVIEW' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting.data]);

  const list = useQuery({
    queryKey: ['event', 'events', status, f.values.q, f.page, status === 'PENDING_REVIEW' ? queueParams : filters.apiParams],
    // the review queue ignores the period
    queryFn: () => listAdminEvents({
      status: status || undefined, q: f.values.q.trim() || undefined, limit: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE,
      ...(status === 'PENDING_REVIEW' ? queueParams : filters.apiParams),
    }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const done = (msg: string) => {
    toast.success(msg);
    setDetail(null);
    void qc.invalidateQueries({ queryKey: ['event', 'events'] });
    void qc.invalidateQueries({ queryKey: ['event', 'dashboard'] });
  };

  const approve = (ev: AdminEvent) => setConfirm({
    title: `Accepter « ${ev.title} » ?`,
    description: 'L’événement est publié et ses billets mis en vente. L’organisateur est prévenu.',
    confirmLabel: 'Accepter et publier',
    tone: 'primary',
    onConfirm: async () => { await approveAdminEvent(ev._id); done('Événement accepté et publié.'); },
  });
  const reject = (ev: AdminEvent) => setConfirm({
    title: `Refuser « ${ev.title} » ?`,
    description: 'Il n’est pas publié. L’organisateur reçoit le motif et peut modifier son événement puis l’envoyer à nouveau. Son compte et ses autres événements ne sont pas touchés.',
    confirmLabel: 'Refuser',
    reason: { label: 'Motif (envoyé à l’organisateur)', required: true, minLength: REJECT_MIN, suggestions: REJECT_SUGGESTIONS },
    onConfirm: async reason => { await rejectAdminEvent(ev._id, reason); done('Événement refusé : l’organisateur est prévenu.'); },
  });
  const suspend = (ev: AdminEvent) => setConfirm({
    title: `Suspendre « ${ev.title} » ?`,
    description: 'Il n’est plus en vente ni visible dans les listes publiques. Les billets déjà vendus restent valables.',
    confirmLabel: 'Suspendre',
    onConfirm: async () => { await suspendAdminEvent(ev._id); done('Événement suspendu.'); },
  });
  const cancel = (ev: AdminEvent) => setConfirm({
    title: `Annuler « ${ev.title} » ?`,
    description: 'Chaque commande payée est remboursée automatiquement sur le solde SBC de l’acheteur, les billets sont annulés, les reventes retirées et les acheteurs prévenus. Action irréversible.',
    confirmLabel: 'Annuler l’événement',
    onConfirm: async () => { await cancelAdminEvent(ev._id, 'Annulation administrateur'); done('Événement annulé.'); },
  });

  const menu = (ev: AdminEvent) => (
    <RowMenu>
      <MenuItem onSelect={() => setDetail(ev)}><HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />Voir les détails</MenuItem>
      {canWrite && ev.status === 'PENDING_REVIEW' && <>
        <MenuItem onSelect={() => approve(ev)}><HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />Accepter et publier</MenuItem>
        <MenuItem destructive onSelect={() => reject(ev)}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Refuser…</MenuItem>
      </>}
      {canWrite && (ev.status === 'PUBLISHED' || canCancel(ev.status)) && <MenuSeparator />}
      {canWrite && ev.status === 'PUBLISHED' && (
        <MenuItem onSelect={() => suspend(ev)}><HugeiconsIcon icon={PauseIcon} size={16} aria-hidden="true" />Suspendre la vente</MenuItem>
      )}
      {canWrite && canCancel(ev.status) && (
        <MenuItem destructive onSelect={() => cancel(ev)}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Annuler l’événement…</MenuItem>
      )}
    </RowMenu>
  );

  const statusCell = (ev: AdminEvent) => (
    <div className="space-y-1">
      <StatusBadge status={ev.status} map={EVENT_STATUS} />
      {ev.status === 'PENDING_REVIEW' && ev.submittedAt && <p className="text-xs text-fg-muted">envoyé <DateText value={ev.submittedAt} /></p>}
      {ev.status === 'REJECTED' && ev.rejectionReason && <p className="max-w-xs truncate text-xs text-danger" title={ev.rejectionReason}>{ev.rejectionReason}</p>}
    </div>
  );
  const title = (ev: AdminEvent) => (
    <TwoLines
      main={<>{ev.title}{isWebinaire(ev) && <Badge tone="info" className="ml-2 align-middle">Webinaire</Badge>}</>}
      sub={eventPlace(ev) || ev.slug}
    />
  );

  const columns: ListColumn<AdminEvent>[] = [
    { key: 'title', header: 'Événement', cell: title },
    { key: 'status', header: 'Statut', cell: statusCell },
    { key: 'date', header: 'Date', cell: ev => <DateText value={ev.startsAt} /> },
    { key: 'sales', header: 'Ventes', numeric: true, cell: ev => <TwoLines main={<Money value={ev.totals?.grossRevenue ?? 0} />} sub={`${formatNumber(ev.totals?.ticketsSold ?? 0)} billets`} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
      cell: ev => (
        <div className="flex items-center justify-end gap-1">
          {ev.status === 'PENDING_REVIEW' && <Button variant="soft" size="sm" onClick={e => { e.stopPropagation(); setDetail(ev); }}>Examiner</Button>}
          {menu(ev)}
        </div>
      ),
    },
  ];

  const card = (ev: AdminEvent) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        {title(ev)}
        <div onClick={e => e.stopPropagation()}>{menu(ev)}</div>
      </div>
      {statusCell(ev)}
      <p className="text-sm text-fg-muted"><DateText value={ev.startsAt} /> · {formatNumber(ev.totals?.ticketsSold ?? 0)} billets · <Money value={ev.totals?.grossRevenue ?? 0} /></p>
      {ev.status === 'PENDING_REVIEW' && <Button variant="soft" size="lg" className="w-full" onClick={e => { e.stopPropagation(); setDetail(ev); }}>Examiner</Button>}
    </div>
  );

  const footer = detail && canWrite ? (
    detail.status === 'PENDING_REVIEW' ? (
      <>
        <Button variant="danger-ghost" size="lg" onClick={() => reject(detail)}>Refuser…</Button>
        <Button variant="primary" size="lg" onClick={() => approve(detail)}>Accepter et publier</Button>
      </>
    ) : (detail.status === 'PUBLISHED' || canCancel(detail.status)) ? (
      <>
        {canCancel(detail.status) && <Button variant="danger-ghost" size="lg" onClick={() => cancel(detail)}>Annuler l’événement…</Button>}
        {detail.status === 'PUBLISHED' && <Button variant="outline" size="lg" onClick={() => suspend(detail)}>Suspendre la vente</Button>}
      </>
    ) : undefined
  ) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Événements"
        description="Chaque événement envoyé par un organisateur est accepté ou refusé par SBC avant sa mise en vente."
      />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          search={<SearchInput value={f.values.q} onChange={v => f.set({ q: v })} placeholder="Titre ou ville" />}
          filterCount={1}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={(
            <FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => f.set({ status: v })}
              options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.value === 'PENDING_REVIEW' && waiting.data ? `${o.label} (${waiting.data})` : o.label }))} />
          )}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} événement{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      {!!waiting.data && status !== 'PENDING_REVIEW' && (
        <Notice tone="warning">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span><strong className="font-semibold">{formatNumber(waiting.data)} événement{waiting.data > 1 ? 's' : ''} à valider.</strong> SBC accepte ou refuse chaque événement avant sa mise en vente.</span>
            <Button variant="soft" size="md" className="h-11 sm:h-9" onClick={() => f.set({ status: 'PENDING_REVIEW', q: '' })}>Examiner</Button>
          </div>
        </Notice>
      )}

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={ev => ev._id}
            onRowClick={setDetail}
            card={card}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={Calendar03Icon}
                title={status === 'PENDING_REVIEW' ? 'Aucun événement à valider' : 'Aucun événement'}
                description={(f.activeCount || filters.isFiltered) ? 'Aucun événement ne correspond à ces filtres.' : 'Les événements créés par les organisateurs apparaîtront ici.'}
                action={(f.activeCount || filters.isFiltered) ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined} />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent
            width="lg"
            title={detail.title}
            description={<StatusBadge status={detail.status} map={EVENT_STATUS} />}
            footer={footer && <Can module="events" write>{footer}</Can>}
          >
            <div className="space-y-5">
              {detail.status === 'REJECTED' && detail.rejectionReason && (
                <Notice tone="danger"><strong className="font-semibold">Motif du refus :</strong> {detail.rejectionReason}</Notice>
              )}
              <SheetSection title="Événement">
                <DetailList items={[
                  ['Lieu', eventPlace(detail) || '—'],
                  isWebinaire(detail) && ['Lien WhatsApp', detail.accessLink
                    ? <a href={detail.accessLink} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{detail.accessLink}</a>
                    : <span className="text-danger">Pas encore renseigné</span>],
                  ['Début', formatDateTime(detail.startsAt)],
                  ['Fin', formatDateTime(detail.endsAt)],
                  ['Adresse publique', <span key="s" className="font-mono text-xs">{detail.slug}</span>],
                ]} />
              </SheetSection>
              <SheetSection title="Ventes">
                <DetailList items={[
                  ['Billets vendus', formatNumber(detail.totals?.ticketsSold ?? 0)],
                  ['Entrées', formatNumber(detail.totals?.checkedIn ?? 0)],
                  ['Chiffre d’affaires', <Money key="m" value={detail.totals?.grossRevenue ?? 0} />],
                ]} />
              </SheetSection>
              <SheetSection title="Validation">
                <DetailList items={[
                  ['Créé le', formatDateTime(detail.createdAt)],
                  !!detail.submittedAt && ['Envoyé pour validation', formatDateTime(detail.submittedAt)],
                  !!detail.reviewedAt && [detail.status === 'REJECTED' ? 'Refusé le' : 'Validé le', formatDateTime(detail.reviewedAt)],
                  ['Identifiant', <CopyId key="id" value={detail._id} />],
                  ['Organisateur', <CopyId key="o" value={detail.organizerId} />],
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
