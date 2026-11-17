import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, FileSecurityIcon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import { auditApi, type AuditFilters } from '../../api/admin';
import { errorMessage } from '../../api/http';
import type { AuditEntry } from '../../api/types';
import { ErrorState } from '../../components/display/ErrorState';
import {
  Button, Dialog, EmptyState, Field, Input, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber } from '../../lib/format';
import { roleLabel } from '../../lib/permissions';

const PAGE_SIZE = 50;
const FILTER_KEYS = ['actor', 'action', 'objectId', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_LABEL: Record<FilterKey, string> = {
  actor: 'Agent (nom ou id)',
  action: 'Action',
  objectId: 'Objet (id)',
  from: 'Du',
  to: 'Au',
};

/** Pretty JSON as text (never HTML). */
function Json({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <p className="text-sm text-fg-subtle">—</p>;
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-surface-2 p-3 font-mono text-xs text-fg">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={cn('text-sm text-fg', mono && 'break-all font-mono text-xs')}>{value === undefined || value === null || value === '' ? '—' : value}</dd>
    </div>
  );
}

const COLUMNS: ListColumn<AuditEntry>[] = [
  { key: 'action', header: 'Action', cell: e => <span className="font-mono text-xs">{e.action}</span> },
  { key: 'seq', header: 'N°', numeric: true, cell: e => formatNumber(e.seq) },
  { key: 'at', header: 'Date', cell: e => formatDateTime(e.at) },
  { key: 'actor', header: 'Agent', cell: e => (e.actor ? <span>{e.actor.name}{e.actor.role && <span className="text-fg-muted"> · {roleLabel(e.actor.role)}</span>}</span> : 'Système') },
  { key: 'object', header: 'Objet', cell: e => (e.object ? <span className="break-all font-mono text-xs">{e.object.type}:{e.object.id}</span> : '—') },
  { key: 'reason', header: 'Motif', cell: e => <span className="line-clamp-2 break-words">{e.reason || '—'}</span> },
  { key: 'ip', header: 'IP', hideOnCard: true, cell: e => <span className="font-mono text-xs">{e.ip ?? '—'}</span> },
  { key: 'request', header: 'Requête', hideOnCard: true, cell: e => <span className="font-mono text-xs">{e.requestId ? e.requestId.slice(0, 8) : '—'}</span> },
];

/** The hash-chained audit log (append-only), with an integrity check. */
export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters: AuditFilters = { page, limit: PAGE_SIZE };
  for (const k of FILTER_KEYS) filters[k] = params.get(k) ?? undefined;

  const [draft, setDraft] = useState<Record<FilterKey, string>>(() => Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) ?? ''])) as Record<FilterKey, string>);
  useEffect(() => {
    setDraft(Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) ?? ''])) as Record<FilterKey, string>);
  }, [params]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const list = useQuery({ queryKey: ['audit', filters], queryFn: () => auditApi.list(filters), placeholderData: prev => prev });
  const verify = useMutation({ mutationFn: auditApi.verify });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) if (draft[k].trim()) next.set(k, draft[k].trim());
    setParams(next, { replace: true });
  };
  const goTo = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  const hasFilters = FILTER_KEYS.some(k => params.get(k));

  return (
    <>
      <PageHeader
        title="Journal d’audit"
        description="Chaque action des agents, en ajout seul. Chaque ligne est chaînée à la précédente par son empreinte : une modification se voit."
        actions={
          <Button variant="primary" onClick={() => verify.mutate()} loading={verify.isPending}>
            <HugeiconsIcon icon={SecurityCheckIcon} size={16} aria-hidden="true" /> Vérifier la chaîne
          </Button>
        }
      />

      {(verify.data || verify.isError) && (
        <div role="status" className={cn(
          'mb-4 flex items-start gap-3 rounded-panel border px-4 py-3 text-sm',
          verify.data?.ok ? 'border-success/30 bg-success-soft text-fg' : 'border-danger/30 bg-danger-soft text-fg',
        )}>
          <HugeiconsIcon icon={verify.data?.ok ? CheckmarkCircle02Icon : Alert02Icon} size={18} aria-hidden="true"
            className={cn('mt-0.5 shrink-0', verify.data?.ok ? 'text-success' : 'text-danger')} />
          <div>
            {verify.isError ? (
              <p className="font-medium">La vérification a échoué : {errorMessage(verify.error)}</p>
            ) : verify.data?.ok ? (
              <p className="font-medium">Chaîne intacte — {formatNumber(verify.data.checked)} entrées vérifiées.</p>
            ) : (
              <>
                <p className="font-medium">Chaîne rompue{verify.data?.firstBrokenSeq != null ? ` à l’entrée n° ${formatNumber(verify.data.firstBrokenSeq)}` : ''}.</p>
                <p className="mt-0.5 text-fg-muted">Une ligne a été modifiée ou supprimée. Prévenez immédiatement le responsable technique.</p>
              </>
            )}
            {verify.data && <p className="mt-0.5 text-xs text-fg-muted">Vérifié le {formatDateTime(verify.data.verifiedAt)}.</p>}
          </div>
        </div>
      )}

      <Panel className="mb-4 p-4">
        <form onSubmit={apply} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" aria-label="Filtres du journal">
          {FILTER_KEYS.map(k => (
            <Field key={k} label={FILTER_LABEL[k]}>
              <Input type={k === 'from' || k === 'to' ? 'date' : 'text'} value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} />
            </Field>
          ))}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">Filtrer</Button>
            {hasFilters && <Button type="button" variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Effacer</Button>}
          </div>
        </form>
      </Panel>

      <Panel>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
        ) : (
          <>
            <ResponsiveList
              rows={list.data?.items ?? []}
              columns={COLUMNS}
              rowKey={e => e.id}
              loading={list.isLoading}
              onRowClick={setSelected}
              empty={<EmptyState icon={FileSecurityIcon} title={hasFilters ? 'Aucune entrée pour ces filtres' : 'Journal vide'} />}
            />
            {list.data && <Pagination page={page} totalPages={Math.ceil(list.data.total / PAGE_SIZE)} total={list.data.total} pageSize={PAGE_SIZE} onPageChange={goTo} />}
          </>
        )}
      </Panel>

      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        {selected && (
          <SheetContent width="lg" title={<span className="font-mono">{selected.action}</span>} description={`Entrée n° ${formatNumber(selected.seq)} · ${formatDateTime(selected.at)}`}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Detail label="Agent" value={selected.actor ? `${selected.actor.name}${selected.actor.role ? ` (${roleLabel(selected.actor.role)})` : ''}` : 'Système'} />
              <Detail label="Objet" value={selected.object ? `${selected.object.type}:${selected.object.id}` : null} mono />
              <Detail label="Motif" value={selected.reason} />
              <Detail label="Adresse IP" value={selected.ip} mono />
              <Detail label="Navigateur" value={selected.userAgent} mono />
              <Detail label="Identifiant de requête" value={selected.requestId} mono />
            </dl>
            <h3 className="mt-5 mb-2 text-sm font-semibold text-fg">Avant</h3>
            <Json value={selected.before} />
            <h3 className="mt-5 mb-2 text-sm font-semibold text-fg">Après</h3>
            <Json value={selected.after} />
            <dl className="mt-5 grid grid-cols-1 gap-3">
              <Detail label="Empreinte" value={selected.hash} mono />
              <Detail label="Empreinte précédente" value={selected.prevHash} mono />
            </dl>
          </SheetContent>
        )}
      </Dialog>
    </>
  );
}
