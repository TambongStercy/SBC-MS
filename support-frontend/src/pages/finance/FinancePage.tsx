import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Clock01Icon, InboxIcon, RefreshIcon } from '@hugeicons/core-free-icons';
import { financeApi, type FinanceFilters } from '../../api/finance';
import { errorMessage } from '../../api/http';
import type { AgeBucket, BusinessStatus, FinanceWithdrawal, RecheckResult } from '../../api/types';
import { usePermissions } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { BUSINESS_STATUS, StatusBadge } from '../../components/display/labels';
import { RankedBars } from '../../components/display/RankedBars';
import { RecheckResultCard } from '../../components/display/RecheckResultCard';
import { toast } from '../../components/toast';
import {
  Button, Dialog, DialogContent, EmptyState, Field, Input, Metric, PageHeader, Pagination, Panel, PanelBody, PanelHeader,
  ResponsiveList, Select, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger, type ListColumn,
} from '../../components/ui';
import { formatDateTime, formatMoney, formatNumber, formatRelative } from '../../lib/format';
import { CaseList } from '../cases/CaseList';
import { GATEWAYS } from '../cases/ManualActivationDialog';
import { RegularizationDialog, type RegularizationTarget } from '../cases/RegularizationDialog';

type Tab = 'tableau' | 'retraits' | 'dossiers';
const ALL = 'all';
const PAGE_SIZE = 20;

export const AGE_BUCKETS: { bucket: AgeBucket; label: string; tone: 'neutral' | 'warning' | 'danger'; hint: string }[] = [
  { bucket: '<24h', label: 'Moins de 24 h', tone: 'neutral', hint: 'Dans les délais' },
  { bucket: '24-48h', label: '24 à 48 h', tone: 'neutral', hint: 'Alerte envoyée' },
  { bucket: '48-72h', label: '48 à 72 h', tone: 'warning', hint: 'Dossier au responsable financier' },
  { bucket: '>72h', label: 'Plus de 72 h', tone: 'danger', hint: 'Alerte critique' },
];
const BUCKET_LABEL = Object.fromEntries(AGE_BUCKETS.map(b => [b.bucket, b.label])) as Record<AgeBucket, string>;

const COUNTRIES: [string, string][] = [
  ['CM', 'Cameroun'], ['CI', 'Côte d’Ivoire'], ['SN', 'Sénégal'], ['BJ', 'Bénin'], ['TG', 'Togo'], ['BF', 'Burkina Faso'],
  ['ML', 'Mali'], ['NE', 'Niger'], ['GA', 'Gabon'], ['CD', 'RD Congo'], ['CG', 'Congo'], ['TD', 'Tchad'], ['GN', 'Guinée'], ['CF', 'Centrafrique'],
];

/** Withdrawals board: 24/48/72 h buckets, the list, and finance cases. */
export default function FinancePage() {
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam === 'tableau' || tabParam === 'retraits' || (tabParam === 'dossiers' && perms.has('cases.work'))
    ? tabParam
    : params.get('ageBucket') || params.get('status') ? 'retraits' : 'tableau';
  const filters: FinanceFilters = {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    country: params.get('country') ?? undefined,
    gateway: params.get('gateway') ?? undefined,
  };

  /** Changes URL params (empty / "all" removes one); any filter change goes back to page 1. */
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === ALL) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Finance" description="Retraits en cours, âge depuis la demande, et dossiers d’anomalie remontés par le rapprochement." />
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="Du" className="w-full sm:w-40">
            <Input type="date" value={filters.from ?? ''} max={filters.to} onChange={e => update({ from: e.target.value })} />
          </Field>
          <Field label="Au" className="w-full sm:w-40">
            <Input type="date" value={filters.to ?? ''} min={filters.from} onChange={e => update({ to: e.target.value })} />
          </Field>
          <Field label="Pays" className="w-full sm:w-48">
            <Select value={filters.country ?? ALL} onValueChange={v => update({ country: v })}
              options={[{ value: ALL, label: 'Tous les pays' }, ...COUNTRIES.map(([v, l]) => ({ value: v, label: l }))]} />
          </Field>
          <Field label="Prestataire" className="w-full sm:w-48">
            <Select value={filters.gateway ?? ALL} onValueChange={v => update({ gateway: v })}
              options={[{ value: ALL, label: 'Tous' }, ...GATEWAYS.map(g => ({ value: g, label: g }))]} />
          </Field>
          {(filters.from || filters.to || filters.country || filters.gateway) && (
            <Button variant="ghost" onClick={() => update({ from: null, to: null, country: null, gateway: null })}>Effacer les filtres</Button>
          )}
        </div>
      </Panel>

      <Tabs value={tab} onValueChange={v => update({ tab: v, ...(v !== 'retraits' ? { ageBucket: null, status: null } : {}) })}>
        <TabsList aria-label="Vues de la finance" className="mb-4">
          <TabsTrigger value="tableau">Tableau de bord</TabsTrigger>
          <TabsTrigger value="retraits">Retraits</TabsTrigger>
          {perms.has('cases.work') && <TabsTrigger value="dossiers">Dossiers</TabsTrigger>}
        </TabsList>
        <TabsContent value="tableau">
          <Dashboard filters={filters} onBucket={b => update({ tab: 'retraits', ageBucket: b })} onStatus={s => update({ tab: 'retraits', status: s })} />
        </TabsContent>
        <TabsContent value="retraits">
          <Withdrawals
            filters={filters}
            status={params.get('status') ?? ''}
            ageBucket={(params.get('ageBucket') as AgeBucket | null) ?? ''}
            page={Number(params.get('page')) || 1}
            update={update}
          />
        </TabsContent>
        {perms.has('cases.work') && (
          <TabsContent value="dossiers">
            <CaseList scope="finance" />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

function Dashboard({ filters, onBucket, onStatus }: { filters: FinanceFilters; onBucket: (b: AgeBucket) => void; onStatus: (s: string) => void }) {
  const q = useQuery({ queryKey: ['finance', 'summary', filters], queryFn: () => financeApi.summary(filters) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const s = q.data;
  const currency = s?.currency ?? 'XAF';
  const byStatus = [...(s?.byStatus ?? [])].sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="buckets-title">
        <h2 id="buckets-title" className="mb-1 text-base font-semibold text-fg">Retraits non terminés, par ancienneté</h2>
        <p className="mb-3 text-sm text-fg-muted">Fonds réservés, en attente d’une réponse finale du prestataire. Ils ne sont jamais libérés sur un simple délai.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {AGE_BUCKETS.map(b => {
            const row = s?.ageBuckets?.find(x => x.bucket === b.bucket);
            const count = row?.count ?? 0;
            return (
              <Metric
                key={b.bucket}
                label={b.label}
                icon={b.tone === 'danger' ? Alert02Icon : Clock01Icon}
                tone={count > 0 ? b.tone : 'neutral'}
                value={q.isLoading ? <Skeleton className="h-7 w-12" /> : <span data-testid={`bucket-${b.bucket}`}>{formatNumber(count)}</span>}
                hint={q.isLoading ? undefined : `${formatMoney(row?.amount ?? 0, currency)} · ${b.hint}`}
                onClick={() => onBucket(b.bucket)}
              />
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Par statut" description="Nombre et montant des retraits de la période, par statut métier." />
          {q.isLoading ? <PanelBody><Skeleton className="h-40 w-full" /></PanelBody> : byStatus.length === 0 ? (
            <EmptyState icon={InboxIcon} title="Aucun retrait sur la période" />
          ) : (
            <Table>
              <THead><tr><TH>Statut</TH><TH numeric>Nombre</TH><TH numeric>Montant</TH></tr></THead>
              <TBody>
                {byStatus.map(r => (
                  <TR key={r.status} className="cursor-pointer" tabIndex={0} onClick={() => onStatus(r.status)}
                    onKeyDown={e => { if (e.key === 'Enter') onStatus(r.status); }}>
                    <TD><StatusBadge map={BUSINESS_STATUS} value={r.status} /></TD>
                    <TD numeric>{formatNumber(r.count)}</TD>
                    <TD numeric>{formatMoney(r.amount, currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Répartition" description="Part de chaque statut dans le nombre de retraits." />
          <PanelBody>
            {q.isLoading ? <Skeleton className="h-40 w-full" /> : (
              <RankedBars items={byStatus.map(r => ({ key: r.status, label: BUSINESS_STATUS[r.status as BusinessStatus]?.label ?? r.status, value: r.count }))} emptyText="Aucun retrait sur la période." />
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function Withdrawals({ filters, status, ageBucket, page, update }: {
  filters: FinanceFilters;
  status: string;
  ageBucket: AgeBucket | '';
  page: number;
  update: (patch: Record<string, string | null>) => void;
}) {
  const perms = usePermissions();
  const query = { ...filters, status: status || undefined, ageBucket, page, limit: PAGE_SIZE };
  const q = useQuery({ queryKey: ['finance', 'withdrawals', query], queryFn: () => financeApi.withdrawals(query), placeholderData: keepPreviousData });
  const [checked, setChecked] = useState<{ tx: string; result: RecheckResult } | null>(null);
  const [regTarget, setRegTarget] = useState<RegularizationTarget | null>(null);

  const recheck = useMutation({
    mutationFn: (tx: string) => financeApi.recheck(tx),
    onSuccess: (result, tx) => { setChecked({ tx, result }); void q.refetch(); },
    onError: e => toast.error(errorMessage(e)),
  });

  const columns: ListColumn<FinanceWithdrawal>[] = [
    {
      key: 'member',
      header: 'Membre',
      cell: w => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{w.memberName || w.userId}</p>
          <p className="truncate font-mono text-xs text-fg-muted">{w.transactionId}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Montant', numeric: true, cell: w => formatMoney(w.amount, w.currency) },
    { key: 'status', header: 'Statut', cell: w => <StatusBadge map={BUSINESS_STATUS} value={w.businessStatus} /> },
    { key: 'method', header: 'Moyen', cell: w => [w.gateway, w.method].filter(Boolean).join(' · ') || '—' },
    { key: 'country', header: 'Pays', cell: w => w.country || '—' },
    { key: 'age', header: 'Âge', cell: w => <span title={w.ageBucket ? BUCKET_LABEL[w.ageBucket] : undefined}>{formatRelative(w.createdAt)}</span> },
    { key: 'created', header: 'Demandé le', cell: w => formatDateTime(w.createdAt), hideOnCard: true },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: w => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {perms.has('finance.recheck') && (
            <Button size="sm" variant="outline" onClick={() => recheck.mutate(w.transactionId)} loading={recheck.isPending && recheck.variables === w.transactionId}
              aria-label={`Revérifier le retrait ${w.transactionId}`}>
              <HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true" /> Revérifier
            </Button>
          )}
          {perms.has('finance.regularize.request') && (
            <Button size="sm" variant="ghost" onClick={() => setRegTarget({ transactionId: w.transactionId, amount: w.amount, currency: w.currency, memberName: w.memberName })}
              aria-label={`Demander une régularisation du retrait ${w.transactionId}`}>
              Régulariser
            </Button>
          )}
        </div>
      ),
    },
  ];

  const statusOptions = [{ value: ALL, label: 'Tous les statuts' }, ...(Object.keys(BUSINESS_STATUS) as BusinessStatus[]).map(s => ({ value: s, label: BUSINESS_STATUS[s].label }))];
  const data = q.data;

  return (
    <Panel>
      <div className="flex flex-wrap gap-2 border-b border-line p-3">
        <Select className="w-full sm:w-56" value={status || ALL} onValueChange={v => update({ status: v })} options={statusOptions} />
        <Select className="w-full sm:w-48" value={ageBucket || ALL} onValueChange={v => update({ ageBucket: v })}
          options={[{ value: ALL, label: 'Toute ancienneté' }, ...AGE_BUCKETS.map(b => ({ value: b.bucket, label: b.label }))]} />
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : (
        <>
          <ResponsiveList
            rows={data?.items ?? []}
            columns={columns}
            rowKey={w => w.transactionId}
            loading={q.isLoading}
            empty={<EmptyState icon={InboxIcon} title="Aucun retrait" description="Aucun retrait ne correspond à ces filtres." />}
          />
          {data && <Pagination page={data.page} totalPages={Math.max(1, Math.ceil(data.total / (data.limit || PAGE_SIZE)))} total={data.total} pageSize={data.limit || PAGE_SIZE} onPageChange={p => update({ page: String(p) })} />}
        </>
      )}

      <Dialog open={!!checked} onOpenChange={o => { if (!o) setChecked(null); }}>
        {checked && (
          <DialogContent title="Revérification du retrait" description={<span className="break-all font-mono">{checked.tx}</span>}>
            <RecheckResultCard result={checked.result} />
            <p className="mt-3 text-sm text-fg-muted">
              Le statut ne change que si le prestataire donne une réponse finale. Une annulation demandée n’est pas une annulation confirmée : les fonds restent réservés jusqu’à la confirmation.
            </p>
          </DialogContent>
        )}
      </Dialog>
      <RegularizationDialog target={regTarget} onOpenChange={o => { if (!o) setRegTarget(null); }} />
    </Panel>
  );
}
