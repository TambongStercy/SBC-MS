import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChartBarLineIcon, Download04Icon } from '@hugeicons/core-free-icons';
import { errorMessage } from '../../api/http';
import { reportsApi } from '../../api/reports';
import type { AgentReportRow } from '../../api/types';
import { useCan } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { RankedBars } from '../../components/display/RankedBars';
import { toast } from '../../components/toast';
import { Button, EmptyState, Field, Input, Metric, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList, Segmented, type ListColumn } from '../../components/ui';
import { downloadBlob } from '../../lib/download';
import { formatDuration, formatNumber, formatPercent, isoDay } from '../../lib/format';
import { roleLabel } from '../../lib/permissions';

type Preset = '7d' | '30d' | 'month' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7d', label: '7 j' },
  { value: '30d', label: '30 j' },
  { value: 'month', label: 'Mois en cours' },
  { value: 'custom', label: 'Personnalisé' },
];

/** from/to (yyyy-mm-dd, inclusive) for a preset; `custom` keeps the URL values. */
export function periodFor(preset: Preset, now = new Date(), custom?: { from?: string | null; to?: string | null }): { from: string; to: string } {
  const to = isoDay(now);
  if (preset === 'month') return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (preset === 'custom' && custom?.from && custom?.to) return { from: custom.from, to: custom.to };
  const days = preset === '30d' ? 29 : 6;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { from: isoDay(start), to };
}

const minutes = (m: number | null) => (m == null ? '—' : formatDuration(m * 60));

const COLUMNS: ListColumn<AgentReportRow>[] = [
  {
    key: 'name', header: 'Agent',
    cell: r => (
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{r.name}</p>
        <p className="truncate text-xs text-fg-muted">{r.roles.map(roleLabel).join(', ')}</p>
      </div>
    ),
  },
  { key: 'tickets', header: 'Tickets traités', numeric: true, cell: r => formatNumber(r.ticketsHandled) },
  { key: 'resolved', header: 'Tickets résolus', numeric: true, cell: r => formatNumber(r.ticketsResolved) },
  { key: 'firstResponse', header: '1re réponse (moy.)', numeric: true, cell: r => minutes(r.avgFirstResponseMinutes) },
  { key: 'cases', header: 'Dossiers résolus', numeric: true, cell: r => formatNumber(r.casesResolved) },
  { key: 'views', header: 'Preuves décidées', numeric: true, cell: r => formatNumber(r.viewsDecided) },
  { key: 'approved', header: 'Validées', numeric: true, cell: r => formatNumber(r.viewsApproved) },
  { key: 'rejected', header: 'Rejetées', numeric: true, cell: r => formatNumber(r.viewsRejected) },
  { key: 'reassigned', header: 'Réaffectées', numeric: true, cell: r => formatNumber(r.viewsReassigned) },
  { key: 'decision', header: 'Temps de décision (moy.)', numeric: true, cell: r => formatDuration(r.avgDecisionSeconds) },
  { key: 'qa', header: 'Erreurs QA', numeric: true, cell: r => formatPercent(r.qaErrorRate) },
];

/** Activity per agent over a period; CSV export for agents with `export`. */
export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const canExport = useCan('export');
  const preset = (PRESETS.some(p => p.value === params.get('periode')) ? params.get('periode') : '7d') as Preset;
  const { from, to } = useMemo(
    () => periodFor(preset, new Date(), { from: params.get('du'), to: params.get('au') }),
    [preset, params],
  );
  const [exporting, setExporting] = useState(false);

  const report = useQuery({ queryKey: ['reports', 'agents', from, to], queryFn: () => reportsApi.agents({ from, to }) });
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);

  const totals = useMemo(() => {
    const qa = rows.map(r => r.qaErrorRate).filter((v): v is number => v != null);
    return {
      tickets: rows.reduce((s, r) => s + r.ticketsHandled, 0),
      views: rows.reduce((s, r) => s + r.viewsDecided, 0),
      cases: rows.reduce((s, r) => s + r.casesResolved, 0),
      qa: qa.length ? qa.reduce((s, v) => s + v, 0) / qa.length : null,
    };
  }, [rows]);

  const setPreset = (p: Preset) => {
    const next = new URLSearchParams(params);
    next.set('periode', p);
    if (p === 'custom') {
      next.set('du', from);
      next.set('au', to);
    } else {
      next.delete('du');
      next.delete('au');
    }
    setParams(next, { replace: true });
  };

  const setCustom = (key: 'du' | 'au', value: string) => {
    if (!value) return;
    const next = new URLSearchParams(params);
    next.set('periode', 'custom');
    next.set('du', key === 'du' ? value : from);
    next.set('au', key === 'au' ? value : to);
    setParams(next, { replace: true });
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await reportsApi.exportAgents({ from, to });
      downloadBlob(blob, `sbc-support-rapport-${from}-${to}.csv`);
      toast.success('Export téléchargé.');
    } catch (e) {
      toast.error(errorMessage(e, 'L’export a échoué.'));
    } finally {
      setExporting(false);
    }
  };

  const viewBars = rows.filter(r => r.viewsDecided > 0).map(r => ({ key: r.agentId, label: r.name, value: r.viewsDecided }));

  return (
    <>
      <PageHeader
        title="Rapports"
        description="Activité de chaque agent sur la période : tickets, dossiers et vérifications."
        actions={canExport ? (
          <Button onClick={doExport} loading={exporting} disabled={!rows.length}>
            <HugeiconsIcon icon={Download04Icon} size={16} aria-hidden="true" /> Exporter en CSV
          </Button>
        ) : undefined}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Segmented label="Période" value={preset} onValueChange={setPreset} options={PRESETS} />
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Field label="Du"><Input type="date" value={from} max={to} onChange={e => setCustom('du', e.target.value)} /></Field>
              <Field label="Au"><Input type="date" value={to} min={from} onChange={e => setCustom('au', e.target.value)} /></Field>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Tickets traités" value={formatNumber(totals.tickets)} />
        <Metric label="Dossiers résolus" value={formatNumber(totals.cases)} />
        <Metric label="Preuves décidées" value={formatNumber(totals.views)} />
        <Metric label="Erreurs QA (moyenne)" value={formatPercent(totals.qa)} />
      </div>

      <Panel className="mt-6">
        <PanelHeader title="Par agent" description={`Du ${from} au ${to}`} />
        {report.isError ? (
          <ErrorState error={report.error} onRetry={() => report.refetch()} retrying={report.isFetching} />
        ) : (
          <ResponsiveList
            rows={rows}
            columns={COLUMNS}
            rowKey={r => r.agentId}
            loading={report.isLoading}
            empty={<EmptyState icon={ChartBarLineIcon} title="Aucune activité sur cette période" />}
          />
        )}
      </Panel>

      {viewBars.length > 1 && (
        <Panel className="mt-6">
          <PanelHeader title="Preuves décidées par agent" description="Classement sur la période." />
          <PanelBody><RankedBars items={viewBars} /></PanelBody>
        </Panel>
      )}
    </>
  );
}
