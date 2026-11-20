import { useId, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { cn } from '../../lib/cn';

/**
 * Line and area charts for the analytics page, one look for all of them:
 * thin 2px lines, recessive grid and axes, one axis per chart, a legend whenever
 * there are 2+ series, a crosshair tooltip listing every series at that date
 * (value first), and a data table under the chart for screen readers and exact
 * figures. Colours are the desk's validated chart tokens (light and dark).
 */

export type Series<K extends string> = { key: K; label: string; color: 1 | 2 | 3 };

const COLOR = { 1: 'var(--chart-1)', 2: 'var(--chart-2)', 3: 'var(--chart-3)' } as const;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

type Row = { date: string } & Record<string, number | string | null>;

function ChartTooltip<K extends string>({ active, payload, label, series, format }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: unknown; series: Series<K>[]; format: (v: number | null) => string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row;
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg-muted">{dayLabel(String(label))}</p>
      {series.map(s => (
        <p key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-fg-muted">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR[s.color] }} aria-hidden="true" />{s.label}
          </span>
          <strong className="tabular-nums text-fg">{format((row?.[s.key] as number | null) ?? null)}</strong>
        </p>
      ))}
    </div>
  );
}

function Legend<K extends string>({ series }: { series: Series<K>[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Légende">
      {series.map(s => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: COLOR[s.color] }} aria-hidden="true" />{s.label}
        </li>
      ))}
    </ul>
  );
}

function DataTable<K extends string>({ data, series, format, caption }: { data: Row[]; series: Series<K>[]; format: (v: number | null) => string; caption: string }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-fg-muted hover:text-fg">Voir les données</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-2 text-fg-muted">
            <tr><th scope="col" className="px-2 py-1 font-medium">Jour</th>{series.map(s => <th key={s.key} scope="col" className="px-2 py-1 text-right font-medium">{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.date} className="border-t border-line">
                <th scope="row" className="px-2 py-1 font-normal text-fg-muted">{dayLabel(r.date)}</th>
                {series.map(s => <td key={s.key} className="px-2 py-1 text-right text-fg">{format((r[s.key] as number | null) ?? null)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function TrendChart<K extends string>({ kind, data, series, format = v => (v == null ? '—' : v.toLocaleString('fr-FR')), stacked = false, height = 220, title, description, className }: {
  kind: 'line' | 'area';
  data: Row[];
  series: Series<K>[];
  format?: (v: number | null) => string;
  stacked?: boolean;
  height?: number;
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const axis = { stroke: 'var(--line-strong)', tick: { fill: 'var(--fg-muted)', fontSize: 11 }, tickLine: false };
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--line)" />
      <XAxis dataKey="date" {...axis} tickFormatter={dayLabel} minTickGap={24} />
      <YAxis {...axis} axisLine={false} width={40} allowDecimals={false} tickFormatter={v => Number(v).toLocaleString('fr-FR')} />
      <Tooltip cursor={{ stroke: 'var(--fg-subtle)', strokeWidth: 1 }} content={(p: TooltipContentProps<ValueType, NameType>) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} format={format} />} />
    </>
  );
  return (
    <figure className={cn('min-w-0', className)} aria-labelledby={`${id}-t`}>
      <figcaption>
        <h3 id={`${id}-t`} className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </figcaption>
      <div className="mt-3"><Legend series={series} /></div>
      <div style={{ height }} role="img" aria-label={`${title} : graphique, détail dans « Voir les données »`}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              {common}
              {series.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLOR[s.color]} strokeWidth={2} dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              {common}
              {series.map(s => (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId={stacked ? 'a' : undefined}
                  stroke={stacked ? 'var(--surface)' : COLOR[s.color]} strokeWidth={2} fill={COLOR[s.color]} fillOpacity={stacked ? 0.85 : 0.18}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: COLOR[s.color] }} isAnimationActive={false} />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <DataTable data={data} series={series} format={format} caption={title} />
    </figure>
  );
}
