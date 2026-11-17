import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Award01Icon, DiceIcon, LockIcon, PlusSignIcon, SquareUnlock01Icon, Ticket01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import {
  TombolaStatus, createTombolaMonth, listTombolaMonths, updateTombolaStatus, type TombolaMonth,
} from '../services/adminTombolaApi';
import { usePermission } from '../hooks/usePermission';
import { Can } from '../components/Can';
import {
  Button, EmptyState, MenuItem, MenuSeparator, Metric, PageHeader, Pagination, Panel, ResponsiveList, Skeleton, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, DateText, ErrorState, RowMenu, count, StatusBadge, TodoAction, TodoPanel, formatDelta, formatNumber, useUrlFilters,
  type ConfirmOptions, type TodoItem,
} from '../components/moduleKit';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { MonthlyTicketsChart } from '../components/tombola/MonthlyTicketsChart';
import CreateTombolaModal from '../components/tombola/CreateTombolaModal';
import TombolaSheet from '../components/tombola/ViewTicketsModal';
import { TOMBOLA_STATUS, monthLabel, monthTitle } from '../components/tombola/labels';

const PAGE_SIZE = 10;
const isDrawable = (t: TombolaMonth) => t.status === TombolaStatus.OPEN || t.status === TombolaStatus.DRAWING;
const ym = (t: Pick<TombolaMonth, 'month' | 'year'>) => t.year * 12 + (t.month - 1);

/**
 * Tombola (module `tombola`): one tombola per month. What needs doing first
 * (a past month still open = a draw is due, no tombola this month), then the
 * figures, tickets sold per month and the list. The service draws only an
 * OPEN tombola.
 */
export default function TombolaManagementPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = usePermission('tombola') === 'write';
  const f = useUrlFilters([] as const);
  const filters = usePageFilters();
  const api = filters.apiParams;
  // The queue and the figures ignore the period (country only)
  const queueApi = api.country ? { country: api.country } : {};
  const [creating, setCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState<TombolaMonth | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  const list = useQuery({
    queryKey: ['tombola', 'months', f.page, api],
    queryFn: () => listTombolaMonths({ page: f.page, limit: PAGE_SIZE, ...api }),
    placeholderData: keepPreviousData,
  });
  // The last two years, for the queue, the figures and the chart
  const recent = useQuery({
    queryKey: ['tombola', 'months', 'recent', queueApi],
    queryFn: () => listTombolaMonths({ page: 1, limit: 24, ...queueApi }),
  });
  // Tickets per month over the chosen period
  const chartQ = useQuery({
    queryKey: ['tombola', 'months', 'chart', api],
    queryFn: () => listTombolaMonths({ page: 1, limit: 100, ...api }),
  });

  const rows = list.data?.data ?? [];
  const pg = list.data?.pagination;

  const now = new Date();
  const nowYm = now.getFullYear() * 12 + now.getMonth();
  const summary = useMemo(() => {
    const all = recent.data?.data ?? [];
    const current = all.find(t => ym(t) === nowYm) ?? null;
    const previous = all.find(t => ym(t) === nowYm - 1) ?? null;
    const overdue = all.filter(t => isDrawable(t) && ym(t) < nowYm).sort((a, b) => ym(a) - ym(b));
    const openOne = all.find(t => t.status === TombolaStatus.OPEN) ?? null;
    const lastDrawn = all.filter(t => t.status === TombolaStatus.CLOSED && t.winners?.length).sort((a, b) => ym(b) - ym(a))[0] ?? null;
    return { current, previous, overdue, openOne, lastDrawn };
  }, [recent.data, nowYm]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['tombola', 'months'] });

  const handleCreate = async (month: number, year: number) => {
    setIsSubmitting(true);
    try {
      await createTombolaMonth(month, year);
      toast.success(`Tombola de ${monthLabel(month, year)} créée.`);
      setCreating(false);
      void refresh();
    } catch (err) {
      toast.error(`La tombola n’a pas pu être créée : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeStatus = (t: TombolaMonth, status: TombolaStatus.OPEN | TombolaStatus.CLOSED) => setConfirm({
    title: status === TombolaStatus.OPEN ? `Rouvrir la tombola de ${monthLabel(t.month, t.year)} ?` : `Fermer la tombola de ${monthLabel(t.month, t.year)} ?`,
    description: status === TombolaStatus.OPEN
      ? 'Les membres pourront de nouveau y acheter des tickets. Toute autre tombola ouverte sera fermée.'
      : 'Plus aucun ticket ne pourra être acheté. Attention : le service ne tire qu’une tombola ouverte.',
    confirmLabel: status === TombolaStatus.OPEN ? 'Rouvrir' : 'Fermer la tombola',
    tone: status === TombolaStatus.OPEN ? 'primary' : 'danger',
    onConfirm: async () => {
      const updated = await updateTombolaStatus(t._id, status);
      toast.success('Statut de la tombola mis à jour.');
      if (open?._id === t._id) setOpen(updated);
      void refresh();
    },
  });

  const goDraw = (t: TombolaMonth) => navigate(`/tombola/draw/${t._id}`);

  const primary = (t: TombolaMonth, phone = false) => {
    const cls = phone ? 'h-11 flex-1' : '';
    if (isDrawable(t) && canWrite) {
      const none = (t.lastTicketNumber ?? 0) === 0;
      return (
        <Button variant="soft" size="md" className={cls} disabled={none} onClick={() => goDraw(t)}>
          <HugeiconsIcon icon={DiceIcon} size={16} aria-hidden="true" />
          {none ? 'Aucun ticket' : 'Tirage'}
        </Button>
      );
    }
    return (
      <Button variant="ghost" size="md" className={cls} onClick={() => goDraw(t)}>
        <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />
        Voir le tirage
      </Button>
    );
  };

  const menu = (t: TombolaMonth) => (
    <RowMenu>
      <MenuItem onSelect={() => setOpen(t)}>
        <HugeiconsIcon icon={Ticket01Icon} size={16} aria-hidden="true" />
        Voir les tickets
      </MenuItem>
      {canWrite && (t.status === TombolaStatus.OPEN || t.status === TombolaStatus.CLOSED) && <MenuSeparator />}
      {canWrite && t.status === TombolaStatus.OPEN && (
        <MenuItem destructive onSelect={() => changeStatus(t, TombolaStatus.CLOSED)}>
          <HugeiconsIcon icon={LockIcon} size={16} aria-hidden="true" />
          Fermer la tombola
        </MenuItem>
      )}
      {canWrite && t.status === TombolaStatus.CLOSED && (
        <MenuItem onSelect={() => changeStatus(t, TombolaStatus.OPEN)}>
          <HugeiconsIcon icon={SquareUnlock01Icon} size={16} aria-hidden="true" />
          Rouvrir la tombola
        </MenuItem>
      )}
    </RowMenu>
  );

  const actions = (t: TombolaMonth, phone = false) => (
    <div className={phone ? 'flex items-center gap-2' : 'flex items-center justify-end gap-1'} onClick={e => e.stopPropagation()}>
      {primary(t, phone)}
      {menu(t)}
    </div>
  );

  const columns: ListColumn<TombolaMonth>[] = [
    { key: 'month', header: 'Mois', cell: t => <span className="font-medium">{monthTitle(t.month, t.year)}</span> },
    { key: 'status', header: 'Statut', cell: t => <StatusBadge status={t.status} map={TOMBOLA_STATUS} /> },
    { key: 'tickets', header: 'Tickets vendus', cell: t => formatNumber(t.lastTicketNumber ?? 0), numeric: true },
    { key: 'winners', header: 'Gagnants', cell: t => formatNumber(t.winners?.length ?? 0), numeric: true },
    { key: 'draw', header: 'Tirage', cell: t => (t.drawDate ? <DateText value={t.drawDate} className="text-fg-muted" /> : <span className="text-fg-subtle">Pas encore</span>) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, cell: t => actions(t), hideOnCard: true },
  ];

  const card = (t: TombolaMonth) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">{monthTitle(t.month, t.year)}</span>
        <StatusBadge status={t.status} map={TOMBOLA_STATUS} />
      </div>
      <p className="text-sm text-fg-muted">
        <span className="tabular-nums text-fg">{formatNumber(t.lastTicketNumber ?? 0)}</span> tickets ·{' '}
        <span className="tabular-nums text-fg">{formatNumber(t.winners?.length ?? 0)}</span> gagnants
        {t.drawDate && <> · tiré <DateText value={t.drawDate} /></>}
      </p>
      {actions(t, true)}
    </div>
  );

  const todo: TodoItem[] = [];
  if (summary.overdue.length) {
    const first = summary.overdue[0];
    todo.push({
      key: 'draw', count: summary.overdue.length, tone: 'warning',
      label: summary.overdue.length > 1 ? 'Tirages en retard' : `Tirage à faire : ${monthLabel(first.month, first.year)}`,
      hint: `Le mois est fini et la tombola est encore ${first.status === TombolaStatus.DRAWING ? 'en cours de tirage' : 'ouverte'} (${count(first.lastTicketNumber ?? 0, 'ticket')}).`,
      action: <TodoAction onClick={() => goDraw(first)}>Ouvrir le tirage</TodoAction>,
    });
  }
  if (recent.data && !summary.current) {
    todo.push({
      key: 'create', count: 1, tone: 'info',
      label: `Pas de tombola pour ${monthLabel(now.getMonth() + 1, now.getFullYear())}`,
      hint: 'Les membres ne peuvent pas acheter de ticket ce mois-ci.',
      action: canWrite ? <TodoAction onClick={() => setCreating(true)}>Créer la tombola</TodoAction> : undefined,
    });
  }

  const cur = summary.current;
  const delta = cur ? formatDelta(cur.lastTicketNumber ?? 0, summary.previous?.lastTicketNumber) : null;
  const v = (node: ReactNode) => (recent.isLoading ? <Skeleton className="h-7 w-24" /> : node);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tombola"
        description="Une tombola par mois : ventes de tickets, ouverture et fermeture, tirage des gagnants."
        actions={(
          <Can module="tombola" write>
            <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setCreating(true)}>
              <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden="true" />
              Nouvelle tombola
            </Button>
          </Can>
        )}
      />

      <PageFilters filters={filters} className="mb-6" />

      {recent.isError
        ? <Panel><ErrorState error={recent.error} onRetry={() => void recent.refetch()} retrying={recent.isFetching} /></Panel>
        : <TodoPanel loading={recent.isLoading} items={todo} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Tombola ouverte" icon={Ticket01Icon}
          value={v(summary.openOne ? monthTitle(summary.openOne.month, summary.openOne.year) : 'Aucune')}
          hint={summary.openOne ? 'Les membres y achètent leurs tickets.' : 'Aucun ticket ne peut être acheté.'} />
        <Metric label="Tickets vendus ce mois-ci"
          value={v(cur ? formatNumber(cur.lastTicketNumber ?? 0) : '—')}
          hint={cur ? (delta ?? (summary.previous ? 'Comme le mois dernier' : 'Pas de tombola le mois dernier')) : 'Pas de tombola ce mois-ci'} />
        <Metric label="Dernier tirage" icon={Award01Icon}
          value={v(summary.lastDrawn ? `${formatNumber(summary.lastDrawn.winners.length)} gagnants` : '—')}
          hint={summary.lastDrawn ? monthTitle(summary.lastDrawn.month, summary.lastDrawn.year) : 'Aucun tirage récent'} />
      </div>

      <Panel>
        {chartQ.isLoading
          ? <div className="p-5"><Skeleton className="h-56 w-full" /></div>
          : chartQ.isError
            ? <ErrorState title="Le graphique n’a pas pu être chargé" error={chartQ.error} onRetry={() => void chartQ.refetch()} retrying={chartQ.isFetching} />
            : <MonthlyTicketsChart tombolas={chartQ.data?.data ?? []} range={filters.range} />}
      </Panel>

      <Panel className={list.isFetching && !list.isLoading ? 'overflow-hidden opacity-60 transition-opacity' : 'overflow-hidden'}>
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-fg">Toutes les tombolas</h2>
        </div>
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={t => t._id}
          card={card}
          onRowClick={setOpen}
          loading={list.isLoading}
          empty={list.isError
            ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
            : <EmptyState icon={Ticket01Icon} title="Aucune tombola" description="Créez la tombola du mois pour que les membres puissent acheter leurs tickets."
                action={canWrite ? <Button variant="primary" size="lg" onClick={() => setCreating(true)}>Nouvelle tombola</Button> : undefined} />}
        />
        {pg && <Pagination page={f.page} totalPages={pg.totalPages || 1} total={pg.totalCount ?? 0} pageSize={PAGE_SIZE} onPageChange={f.setPage} />}
      </Panel>

      <CreateTombolaModal isOpen={creating} onClose={() => setCreating(false)} onSave={handleCreate} isLoading={isSubmitting} />

      <TombolaSheet
        tombola={open}
        api={api}
        onClose={() => setOpen(null)}
        footer={open && (
          <>
            {canWrite && open.status === TombolaStatus.OPEN && (
              <Button variant="danger-ghost" size="lg" onClick={() => changeStatus(open, TombolaStatus.CLOSED)}>Fermer la tombola</Button>
            )}
            {canWrite && open.status === TombolaStatus.CLOSED && (
              <Button variant="outline" size="lg" onClick={() => changeStatus(open, TombolaStatus.OPEN)}>Rouvrir la tombola</Button>
            )}
            <Button variant={isDrawable(open) && canWrite ? 'primary' : 'outline'} size="lg" onClick={() => goDraw(open)}>
              {isDrawable(open) && canWrite ? 'Ouvrir le tirage' : 'Voir le tirage'}
            </Button>
          </>
        )}
      />

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
