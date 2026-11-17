import type { ReactNode } from 'react';
import { ChartLineData02Icon, Table01Icon } from '@hugeicons/core-free-icons';
import { SeriesLegend, TimeSeriesChart, outlierCap, type SeriesDef, type TimePoint, type ValueUnit } from '../charts/TimeSeriesChart';
import { useChartTheme } from '../../hooks/useChartTheme';
import { Panel, PanelHeader, Segmented, Table, TBody, TD, TH, THead, TR } from '../ui';
import { formatMoney, formatNumber } from '../common/format';

export type EvolutionView = 'charts' | 'table';
export type EvolutionWindow = '12' | '24' | 'all';

export interface ChartSpec {
  id: string;
  title: string;
  description: string;
  unit: ValueUnit;
  series: SeriesDef[];
  points: TimePoint[];
  /** Under the chart (e.g. which months the API covers). */
  note?: string;
}

function ChartCard({ spec }: { spec: ChartSpec }) {
  const t = useChartTheme();
  const colors = spec.series.map((_, i) => t.series[i % t.series.length]);
  const outlier = outlierCap(spec.points, spec.series);
  // Every month drawn at the cap, highest first.
  const capped = outlier
    ? spec.points
      .map(p => ({ p, v: Math.max(...spec.series.map(s => Number(p[s.key]) || 0)) }))
      .filter(x => x.v > outlier.cap)
      .sort((a, b) => b.v - a.v)
    : [];
  const total = spec.points.reduce((sum, p) => sum + spec.series.reduce((s, def) => s + (Number(p[def.key]) || 0), 0), 0);
  const fmt = (v: number) => (spec.unit === 'money' ? formatMoney(v) : formatNumber(v));
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-control border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{spec.title}</h3>
          <p className="text-xs text-fg-muted">{spec.description}</p>
        </div>
        <p className="text-right text-xs text-fg-muted">
          Total <span className="block text-base font-semibold text-fg">{fmt(total)}</span>
        </p>
      </div>
      {total > 0 && <SeriesLegend series={spec.series} colors={colors} />}
      {total === 0 ? (
        <p className="flex h-[240px] items-center justify-center rounded-control bg-surface-2 px-4 text-center text-sm text-fg-muted">
          Aucune valeur sur ces mois.
        </p>
      ) : (
        <TimeSeriesChart data={spec.points} series={spec.series} unit={spec.unit} ariaLabel={`${spec.title}, par mois`} />
      )}
      {(capped.length > 0 || spec.note) && (
        <div className="space-y-1 text-xs text-fg-muted">
          {capped.length > 0 && (
            <p>
              {capped.map(x => `${x.p.full} : ${fmt(x.v)}`).join(' ; ')}. {capped.length > 1 ? 'Ces mois sont' : 'Ce mois est'} bien
              au-dessus des autres (import de l’ancien système possible) : dessiné{capped.length > 1 ? 's' : ''} en haut du graphique,
              valeur exacte au survol et dans « Voir les données », pour garder les autres mois lisibles.
            </p>
          )}
          {spec.note && <p>{spec.note}</p>}
        </div>
      )}
    </div>
  );
}

function DataTable({ charts }: { charts: ChartSpec[] }) {
  const keys = Array.from(new Set(charts.flatMap(c => c.points.map(p => p.key)))).sort().reverse();
  const cols = charts.flatMap(c => c.series.map((s, i) => ({ chart: c, s, first: i === 0 })));
  const byKey = (c: ChartSpec) => new Map(c.points.map(p => [p.key, p]));
  const maps = new Map(charts.map(c => [c.id, byKey(c)]));
  const fullOf = (key: string) => charts.flatMap(c => c.points).find(p => p.key === key)?.full ?? key;
  return (
    <Table className="min-w-[56rem]">
      <THead>
        <tr>
          <TH rowSpan={2} className="align-bottom">Mois</TH>
          {charts.map(c => (
            <TH key={c.id} colSpan={c.series.length} numeric={c.series.length === 1} className={c.series.length > 1 ? 'border-l border-line text-center' : 'border-l border-line'} rowSpan={c.series.length > 1 ? 1 : 2}>
              {c.title}
            </TH>
          ))}
        </tr>
        <tr>
          {charts.filter(c => c.series.length > 1).flatMap(c => c.series.map((sd, i) => (
            <TH key={`${c.id}-${sd.key}`} numeric className={i === 0 ? 'border-l border-line' : undefined}>{sd.label}</TH>
          )))}
        </tr>
      </THead>
      <TBody>
        {keys.map(key => (
          <TR key={key}>
            <TD className="whitespace-nowrap">{fullOf(key)}</TD>
            {cols.map(col => {
              const p = maps.get(col.chart.id)?.get(key);
              const v = p ? Number(p[col.s.key]) || 0 : null;
              return (
                <TD key={`${col.chart.id}-${col.s.key}`} numeric className={col.first ? 'whitespace-nowrap border-l border-line' : 'whitespace-nowrap'}>
                  {v === null ? <span className="text-fg-subtle">—</span> : col.chart.unit === 'money' ? formatMoney(v) : formatNumber(v)}
                </TD>
              );
            })}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/**
 * "Évolution": one card per measure (one unit each), by month, or the same
 * figures as a table. The window switch shows only with "Toute la période".
 */
export function EvolutionPanel({ charts, view, onViewChange, windowValue, onWindowChange, showWindow, empty, refetching }: {
  charts: ChartSpec[];
  view: EvolutionView;
  onViewChange: (v: EvolutionView) => void;
  windowValue: EvolutionWindow;
  onWindowChange: (w: EvolutionWindow) => void;
  showWindow: boolean;
  /** Shown instead of the charts (period too short for monthly points…). */
  empty?: ReactNode;
  refetching?: boolean;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Évolution par mois"
        description="Survolez ou touchez un graphique pour lire la valeur exacte d’un mois."
        className="flex-col sm:flex-row"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {showWindow && (
              <Segmented
                label="Fenêtre des graphiques"
                size="sm"
                value={windowValue}
                onValueChange={onWindowChange}
                options={[{ value: '12', label: '12 mois' }, { value: '24', label: '24 mois' }, { value: 'all', label: 'Depuis le début' }]}
              />
            )}
            <Segmented
              label="Affichage"
              size="sm"
              value={view}
              onValueChange={onViewChange}
              options={[
                { value: 'charts', label: 'Graphiques', icon: ChartLineData02Icon },
                { value: 'table', label: 'Voir les données', icon: Table01Icon },
              ]}
            />
          </div>
        )}
      />
      <div className={refetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {empty ? (
          <div className="px-5 pb-5">{empty}</div>
        ) : view === 'table' ? (
          <div className="border-t border-line"><DataTable charts={charts} /></div>
        ) : (
          <div className="grid gap-4 px-5 pb-5 lg:grid-cols-2">
            {charts.map(c => <ChartCard key={c.id} spec={c} />)}
          </div>
        )}
      </div>
    </Panel>
  );
}
