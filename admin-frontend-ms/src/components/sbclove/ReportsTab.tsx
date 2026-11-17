import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, Flag01Icon } from '@hugeicons/core-free-icons';
import { ReportStatus, listReports, reviewReport, type Report, type ReportParty } from '../../services/adminSbcLoveApi';
import { Badge, Button, Dialog, EmptyState, MenuItem, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn } from '../ui';
import { Can } from '../Can';
import {
  ConfirmDialog, DateText, DetailList, ErrorState, RowMenu, SheetSection, StatusBadge, count, formatDateTime,
  type ConfirmOptions,
} from '../moduleKit';
import { PROFILE_STATUS, REPORT_STATUS } from './labels';
import { queueScope, type ApiFilters, type LoveFilters } from './types';

const PAGE_SIZE = 15;
/** Names, not ids: a moderator has to know who reported whom before deciding anything. */
function Party({ party, id, showCount }: { party?: ReportParty; id: string; showCount?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-fg">{party?.displayName ?? 'Membre inconnu'}</p>
      <p className="truncate text-xs text-fg-muted">
        {party?.email ?? id}
        {showCount && typeof party?.reportCount === 'number' && party.reportCount > 1 && (
          <Badge tone="warning" className="ml-2">{count(party.reportCount, 'signalement')}</Badge>
        )}
      </p>
    </div>
  );
}

export function ReportsTab({ f, api }: { f: LoveFilters; api: ApiFilters }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Report | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  // Open reports are a queue: all of them whatever the period (country only)
  const scope = f.values.status === ReportStatus.OPEN ? queueScope(api) : api;
  const query = useQuery({
    queryKey: ['sbclove', 'reports', f.values.status, f.page, scope],
    queryFn: () => listReports({ status: (f.values.status || undefined) as ReportStatus | undefined, page: f.page, limit: PAGE_SIZE, ...scope }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const review = (r: Report, status: ReportStatus.REVIEWED | ReportStatus.DISMISSED) => setConfirm({
    title: status === ReportStatus.REVIEWED ? 'Marquer le signalement comme traité ?' : 'Ignorer le signalement ?',
    description: `Signalement de ${r.reporter?.displayName ?? 'un membre'} contre ${r.reported?.displayName ?? 'un membre'}.`,
    confirmLabel: status === ReportStatus.REVIEWED ? 'Marquer comme traité' : 'Ignorer',
    tone: status === ReportStatus.REVIEWED ? 'primary' : 'danger',
    onConfirm: async () => {
      await reviewReport(r._id, status);
      toast.success('Signalement mis à jour.');
      setOpen(null);
      void qc.invalidateQueries({ queryKey: ['sbclove'] });
    },
  });

  const actions = (r: Report, phone = false) => r.status !== ReportStatus.OPEN ? null : (
    <Can module="sbclove" write>
      <div className={phone ? 'flex items-center gap-2' : 'flex items-center justify-end gap-1'} onClick={e => e.stopPropagation()}>
        <Button variant="soft" size="md" className={phone ? 'h-11 flex-1' : ''} onClick={() => review(r, ReportStatus.REVIEWED)}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
          Traité
        </Button>
        <RowMenu>
          <MenuItem onSelect={() => review(r, ReportStatus.DISMISSED)}>Ignorer le signalement</MenuItem>
        </RowMenu>
      </div>
    </Can>
  );

  const columns: ListColumn<Report>[] = [
    { key: 'reported', header: 'Profil signalé', cell: r => <Party party={r.reported} id={r.reportedUserId} showCount /> },
    { key: 'reason', header: 'Motif', cell: r => <span className="line-clamp-2 max-w-sm text-sm text-fg">{r.reason}</span> },
    { key: 'reporter', header: 'Signalé par', cell: r => <Party party={r.reporter} id={r.reporterId} /> },
    { key: 'status', header: 'Statut', cell: r => <StatusBadge status={r.status} map={REPORT_STATUS} /> },
    { key: 'date', header: 'Date', cell: r => <DateText value={r.createdAt} className="text-fg-muted" /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, cell: r => actions(r), hideOnCard: true },
  ];

  const card = (r: Report) => (
    <div className="space-y-2">
      <Party party={r.reported} id={r.reportedUserId} showCount />
      <p className="line-clamp-3 text-sm text-fg">{r.reason}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <StatusBadge status={r.status} map={REPORT_STATUS} />
        <span>par {r.reporter?.displayName ?? 'un membre'}</span>
        <DateText value={r.createdAt} />
      </div>
      {actions(r, true)}
    </div>
  );

  return (
    <div className="space-y-4">

      <Panel className={query.isFetching && !query.isLoading ? 'overflow-hidden opacity-60 transition-opacity' : 'overflow-hidden'}>
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={r => r._id}
          card={card}
          onRowClick={setOpen}
          loading={query.isLoading}
          empty={query.isError
            ? <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            : <EmptyState icon={Flag01Icon} title="Aucun signalement" description={f.values.status === ReportStatus.OPEN ? 'Aucun signalement en attente.' : 'Les signalements des membres apparaissent ici.'} />}
        />
        {pg && <Pagination page={f.page} totalPages={pg.totalPages} total={pg.total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />}
      </Panel>

      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
        {open && (
          <SheetContent
            title="Signalement"
            description={formatDateTime(open.createdAt)}
            footer={open.status === ReportStatus.OPEN ? (
              <Can module="sbclove" write>
                <Button variant="outline" size="lg" onClick={() => review(open, ReportStatus.DISMISSED)}>Ignorer</Button>
                <Button variant="primary" size="lg" onClick={() => review(open, ReportStatus.REVIEWED)}>Marquer comme traité</Button>
              </Can>
            ) : undefined}
          >
            <div className="space-y-6">
              <SheetSection title="Motif">
                <p className="whitespace-pre-line rounded-panel border border-line bg-surface-2 p-3 text-sm text-fg">{open.reason}</p>
              </SheetSection>
              <SheetSection title="Profil signalé">
                <DetailList items={[
                  ['Membre', open.reported?.displayName ?? '—'],
                  ['E-mail', open.reported?.email ?? '—'],
                  ['Statut du profil', open.reported?.profileStatus ? <StatusBadge status={open.reported.profileStatus} map={PROFILE_STATUS} /> : '—'],
                  ['Signalements reçus', <span className="tabular-nums">{open.reported?.reportCount ?? '—'}</span>],
                  ['Identifiant', <span className="font-mono text-xs">{open.reportedUserId}</span>],
                ]} />
              </SheetSection>
              <SheetSection title="Signalé par">
                <DetailList items={[
                  ['Membre', open.reporter?.displayName ?? '—'],
                  ['E-mail', open.reporter?.email ?? '—'],
                  ['Identifiant', <span className="font-mono text-xs">{open.reporterId}</span>],
                ]} />
              </SheetSection>
              <SheetSection title="Suivi">
                <DetailList items={[
                  ['Statut', <StatusBadge status={open.status} map={REPORT_STATUS} />],
                  !!open.reviewedAt && ['Traité le', formatDateTime(open.reviewedAt)],
                ]} />
              </SheetSection>
              <p className="text-xs text-fg-muted">Pour suspendre le profil signalé, cherchez-le dans l’onglet « Profils ».</p>
            </div>
          </SheetContent>
        )}
      </Dialog>

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
