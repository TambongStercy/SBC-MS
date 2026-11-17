import { useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChartLineData01Icon, Table01Icon } from '@hugeicons/core-free-icons';
import { useChartTheme } from '../../hooks/useChartTheme';
import { Button, Segmented, Table, TBody, TD, TH, THead, TR } from '../ui';
import { formatCompact, formatCompactMoney, formatMoney, formatNumber } from './format';

export interface TrendPoint {
  /** Day ("2026-11-16") or month ("2026-11") */
  date: string;
  value: number;
}

type Period = '30' | '90' | '365';
const PERIODS: { value: Period; label: string }[] = [
  { value: '30', label: '30 j' },
  { value: '90', label: '90 j' },
  { value: '365', label: '12 mois' },
];

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * One measure over time (dataviz method): a 2px line with a 10% wash, no dots,
 * horizontal hairline grid, compact fr ticks, crosshair tooltip with the exact
 * value and date, a period selector (default: recent window) so one spike does
 * not flatten the rest, the peak annotated, and a "Voir les données" table.
 *
 * Daily points are zero-filled over the window; 12 mois sums them by month.
 */
export function TrendChart({ points, kind = 'count', title, description, defaultPeriod = '30', periods = PERIODS, height = 240, emptyText = 'Aucune donnée sur la période.', footer }: {
  points: TrendPoint[];
  kind?: 'count' | 'money';
  title: ReactNode;
  description?: ReactNode;
  defaultPeriod?: Period;
  periods?: { value: Period; label: string }[];
  height?: number;
  emptyText?: string;
  footer?: ReactNode;
}) {
  const chart = useChartTheme();
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [asTable, setAsTable] = useState(false);
  const monthly = points.length > 0 && points.every(p => p.date.length <= 7);

  const data = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const p of points) {
      const k = monthly ? p.date.slice(0, 7) : p.date.slice(0, 10);
      byKey.set(k, (byKey.get(k) ?? 0) + (Number(p.value) || 0));
    }
    const now = new Date();
    if (monthly) {
      // Monthly series as given (e.g. a period filtered server-side), gaps filled with 0
      const keys = [...byKey.keys()].sort();
      const out: { key: string; label: string; full: string; value: number }[] = [];
      const [fy, fm] = keys[0].split('-').map(Number);
      const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
      const span = (ly - fy) * 12 + (lm - fm) + 1;
      const multiYear = fy !== ly;
      for (let i = 0; i < span; i++) {
        const d = new Date(fy, fm - 1 + i, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const short = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
        out.push({
          key: mk,
          label: multiYear ? `${short} ${String(d.getFullYear()).slice(2)}` : short,
          full: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          value: byKey.get(mk) ?? 0,
        });
      }
      return out;
    }
    if (period === '365') {
      // 12 months, oldest first, summed by month
      const out: { key: string; label: string; full: string; value: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        let v = 0;
        for (const [k, val] of byKey) if (k.startsWith(mk)) v += val;
        out.push({
          key: mk,
          label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
          full: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          value: v,
        });
      }
      return out;
    }
    const days = Number(period);
    const out: { key: string; label: string; full: string; value: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const k = dayKey(d);
      out.push({
        key: k,
        label: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', ''),
        full: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        value: byKey.get(k) ?? 0,
      });
    }
    return out;
  }, [points, period, monthly]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const fmtValue = (v: number) => (kind === 'money' ? formatMoney(v) : formatNumber(v));
  const fmtTick = (v: number) => (kind === 'money' ? formatCompactMoney(v) : formatCompact(v));

  // Peak worth naming: clearly above the typical (median of non-zero) value
  const peak = useMemo(() => {
    const nz = data.map(d => d.value).filter(v => v > 0).sort((a, b) => a - b);
    if (nz.length < 3) return null;
    const median = nz[Math.floor(nz.length / 2)];
    const max = data.reduce((m, d) => (d.value > m.value ? d : m), data[0]);
    return max.value >= median * 4 ? max : null;
  }, [data]);


  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-2 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {description ? <>{description} · </> : null}
            <span className="font-medium text-fg">{fmtValue(total)}</span> sur la période
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!monthly && periods.length > 1 && <Segmented label="Période" size="sm" value={period} onValueChange={setPeriod} options={periods} />}
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setAsTable(t => !t)} aria-pressed={asTable} aria-label={asTable ? 'Voir le graphique' : 'Voir les données'}>
            <HugeiconsIcon icon={asTable ? ChartLineData01Icon : Table01Icon} size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{asTable ? 'Voir le graphique' : 'Voir les données'}</span>
          </Button>
        </div>
      </div>

      {total === 0 && !asTable ? (
        <p className="flex items-center justify-center px-4 text-sm text-fg-muted" style={{ height }}>{emptyText}</p>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto px-1 pb-2">
          <Table>
            <THead><tr><TH>{monthly || period === '365' ? 'Mois' : 'Jour'}</TH><TH numeric>Valeur</TH></tr></THead>
            <TBody>
              {[...data].reverse().map(d => (
                <TR key={d.key}><TD className="capitalize">{d.full}</TD><TD numeric>{fmtValue(d.value)}</TD></TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <div className="px-2 pb-3" style={{ height: height + 8 }} role="img" aria-label={`${typeof title === 'string' ? title : 'Évolution'} : ${fmtValue(total)} sur la période`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="trend-wash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.series[0]} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={chart.series[0]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={chart.grid} strokeWidth={1} />
              <XAxis dataKey="label" tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: chart.grid }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis
                tick={{ fill: chart.axis, fontSize: 11, fontVariantNumeric: 'tabular-nums' } as never}
                tickLine={false}
                axisLine={false}
                width={kind === 'money' ? 58 : 40}
                tickFormatter={fmtTick}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { full: string; value: number };
                  return (
                    <div style={chart.tooltip.contentStyle} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-0.5 w-3 rounded" style={{ background: chart.series[0] }} aria-hidden="true" />
                        <span className="text-sm font-semibold tabular-nums">{fmtValue(d.value)}</span>
                      </div>
                      <div className="mt-0.5 text-xs capitalize" style={{ color: chart.text }}>{d.full}</div>
                    </div>
                  );
                }}
              />
              <Area type="linear" dataKey="value" stroke={chart.series[0]} strokeWidth={2} fill="url(#trend-wash)" dot={false}
                activeDot={{ r: 4, fill: chart.series[0], stroke: chart.tooltip.contentStyle.background as string, strokeWidth: 2 }} isAnimationActive={false} />
              {peak && (
                <ReferenceDot x={peak.label} y={peak.value} r={4} fill={chart.series[0]} stroke={chart.tooltip.contentStyle.background as string} strokeWidth={2}
                  label={{ value: `Pic : ${fmtTick(peak.value)}`, position: 'top', fill: chart.text, fontSize: 11 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {footer}
    </div>
  );
}
