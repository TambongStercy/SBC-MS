import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { BarChartHorizontalIcon, TableIcon } from '@hugeicons/core-free-icons';
import { useChartTheme } from '../../hooks/useChartTheme';
import { Panel, PanelHeader, Segmented, Table, TBody, TD, TH, THead, TR } from '../ui';
import { formatCompact, formatMoney } from '../common/format';

export interface EarnedWithdrawnRow {
  id: string;
  name: string;
  earned: number;
  withdrawn: number;
}

const SERIES = [
  { key: 'earned', label: 'Gagné' },
  { key: 'withdrawn', label: 'Retiré' },
] as const;

/** 0 and 3–5 round steps (1, 2, 2.5, 5 × 10ⁿ) covering the largest value. */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

function ChartTooltip({ active, payload, colors }: TooltipProps<number, string> & { colors: string[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as EarnedWithdrawnRow;
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2 text-xs">
      <p className="mb-1.5 font-medium text-fg">{row.name}</p>
      {SERIES.map((s, i) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-fg-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ background: colors[i] }} aria-hidden="true" />
            {s.label}
          </span>
          <span className="font-semibold tabular-nums text-fg">{formatMoney(row[s.key], 'XAF')}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Gagné vs retiré for the first members of the list (same unit, two series):
 * horizontal bars on one baseline, in list order, legend + tooltip, and a
 * table view with the exact figures.
 */
export function EarnedWithdrawnChart({ rows, title, description }: { rows: EarnedWithdrawnRow[]; title: string; description?: string }) {
  const chart = useChartTheme();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const colors = [chart.series[0], chart.series[1]];
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const height = rows.length * 40 + 36;
  const ticks = niceTicks(Math.max(0, ...rows.map(r => Math.max(r.earned, r.withdrawn))));

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        className="flex-col sm:flex-row"
        actions={(
          <Segmented
            size="sm"
            label="Affichage"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'chart', label: 'Graphique', icon: BarChartHorizontalIcon },
              { value: 'table', label: 'Voir les données', icon: TableIcon },
            ]}
          />
        )}
      />
      {view === 'chart' ? (
        <div className="px-2 pb-4 sm:px-4">
          <ul className="mb-2 flex gap-4 px-3 text-xs text-fg-muted" aria-label="Légende">
            {SERIES.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: colors[i] }} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
          <div style={{ height }} role="img" aria-label={`${title} : gagné et retiré par membre, en francs`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" barGap={2} barCategoryGap="28%" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid horizontal={false} stroke={chart.grid} />
                <XAxis
                  type="number"
                  domain={[0, ticks[ticks.length - 1]]}
                  ticks={ticks}
                  interval={0}
                  tickFormatter={v => formatCompact(v)}
                  tick={{ fill: chart.axis, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  className="tabular-nums"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={narrow ? 92 : 150}
                  tickFormatter={v => short(String(v), narrow ? 12 : 20)}
                  tick={{ fill: chart.text, fontSize: 12 }}
                  axisLine={{ stroke: chart.grid }}
                  tickLine={false}
                  interval={0}
                />
                <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip colors={colors} />} />
                <Bar dataKey="earned" name="Gagné" fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={10} isAnimationActive={false} />
                <Bar dataKey="withdrawn" name="Retiré" fill={colors[1]} radius={[0, 4, 4, 0]} maxBarSize={10} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="px-3 pt-1 text-xs text-fg-subtle">Montants en francs (F).</p>
        </div>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Membre</TH>
              <TH numeric>Gagné</TH>
              <TH numeric>Retiré</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map(r => (
              <TR key={r.id}>
                <TD className="max-w-[10rem] truncate">{r.name}</TD>
                <TD numeric>{formatMoney(r.earned, 'XAF')}</TD>
                <TD numeric>{formatMoney(r.withdrawn, 'XAF')}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

