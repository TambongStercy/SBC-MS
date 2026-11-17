import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FolderOpenIcon } from '@hugeicons/core-free-icons';
import { casesApi, type CaseFilters } from '../../api/cases';
import type { CaseStatus, Severity, SupportCase } from '../../api/types';
import { ErrorState } from '../../components/display/ErrorState';
import { CASE_STATUS, CASE_TYPE, SEVERITY, StatusBadge } from '../../components/display/labels';
import { EmptyState, Pagination, Panel, ResponsiveList, Select, type ListColumn } from '../../components/ui';
import { formatRelative } from '../../lib/format';
import { CaseDetailSheet } from './CaseDetailSheet';

const PAGE_SIZE = 20;
const ALL = 'all';

/** Activation cases, or every finance case type. */
export function CaseList({ scope }: { scope: 'activation' | 'finance' }) {
  const [status, setStatus] = useState<CaseStatus | 'active' | typeof ALL>('active');
  const [severity, setSeverity] = useState<Severity | typeof ALL>(ALL);
  const [assignee, setAssignee] = useState<'me' | 'unassigned' | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const filters: CaseFilters = {
    type: scope === 'activation' ? 'activation' : 'finance',
    status: status === ALL ? '' : status,
    severity: severity === ALL ? '' : severity,
    assignee: assignee === ALL ? undefined : assignee,
    page,
    limit: PAGE_SIZE,
  };
  const q = useQuery({ queryKey: ['cases', filters], queryFn: () => casesApi.list(filters), placeholderData: keepPreviousData });

  const reset = <T,>(set: (v: T) => void) => (v: string) => { set(v as T); setPage(1); };

  const columns: ListColumn<SupportCase>[] = [
    {
      key: 'summary',
      header: 'Dossier',
      cell: c => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{c.summary}</p>
          <p className="text-xs text-fg-muted">{CASE_TYPE[c.type] ?? c.type}</p>
        </div>
      ),
    },
    { key: 'severity', header: 'Gravité', cell: c => <StatusBadge map={SEVERITY} value={c.severity} /> },
    { key: 'status', header: 'Statut', cell: c => <StatusBadge map={CASE_STATUS} value={c.status} /> },
    { key: 'member', header: 'Membre', cell: c => c.subject.memberName || c.subject.userId || '—' },
    { key: 'assignee', header: 'Suivi par', cell: c => c.assignee?.name ?? <span className="text-fg-subtle">Personne</span> },
    { key: 'updated', header: 'Mis à jour', cell: c => formatRelative(c.updatedAt) },
  ];

  const data = q.data;
  return (
    <Panel>
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        <Select
          className="w-full sm:w-48"
          value={status}
          onValueChange={reset(setStatus)}
          options={[{ value: 'active', label: 'À traiter' }, { value: ALL, label: 'Tous les statuts' }, ...(Object.keys(CASE_STATUS) as CaseStatus[]).map(s => ({ value: s, label: CASE_STATUS[s].label }))]}
        />
        <Select
          className="w-full sm:w-44"
          value={severity}
          onValueChange={reset(setSeverity)}
          options={[{ value: ALL, label: 'Toute gravité' }, ...(Object.keys(SEVERITY) as Severity[]).map(s => ({ value: s, label: SEVERITY[s].label }))]}
        />
        <Select
          className="w-full sm:w-44"
          value={assignee}
          onValueChange={reset(setAssignee)}
          options={[{ value: ALL, label: 'Tous les agents' }, { value: 'me', label: 'Mes dossiers' }, { value: 'unassigned', label: 'Sans agent' }]}
        />
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <>
          <ResponsiveList
            rows={data?.items ?? []}
            columns={columns}
            rowKey={c => c.id}
            onRowClick={c => setOpenId(c.id)}
            loading={q.isLoading}
            empty={<EmptyState icon={FolderOpenIcon} title="Aucun dossier" description="Aucun dossier ne correspond à ces filtres." />}
          />
          {data && <Pagination page={data.page} totalPages={Math.max(1, Math.ceil(data.total / (data.limit || PAGE_SIZE)))} total={data.total} pageSize={data.limit || PAGE_SIZE} onPageChange={setPage} />}
        </>
      )}
      <CaseDetailSheet caseId={openId} onOpenChange={o => { if (!o) setOpenId(null); }} />
    </Panel>
  );
}
