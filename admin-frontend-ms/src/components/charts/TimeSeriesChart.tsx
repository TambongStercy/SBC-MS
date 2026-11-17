import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { formatCompact, formatMoney, formatNumber } from '../common/format';

export interface SeriesDef {
  key: string;
  label: string;
}

/** One x position: `label` is what the axis shows, `full` what the tooltip shows. */
export interface TimePoint {
  key: string;
  label: string;
  full: string;
  [series: string]: number | string;
}

export type ValueUnit = 'count' | 'money';

export const formatValue = (v: number, unit: ValueUnit) => (unit === 'money' ? formatMoney(v) : formatNumber(v));
const formatTick = (v: number, unit: ValueUnit) => (unit === 'money' && v !== 0 ? `${formatCompact(v)}\u202fF` : formatCompact(v));

/**
 * A month far above the rest (e.g. the March 2025 import) crushes every other
 * month to the baseline. When the highest value is more than 3× the 90th
 * percentile of the others, returns a cap a bit above that percentile: values
 * over it are drawn at the cap with their real value labelled.
 */
export function outlierCap(data: TimePoint[], series: SeriesDef[]): { cap: number; max: number } | null {
  const values = data.flatMap(d => series.map(s => Number(d[s.key]) || 0)).filter(v => v > 0).sort((a, b) => a - b);
  if (values.length < 6) return null;
  const max = values[values.length - 1];
  const rest = values.slice(0, -1);
  const ref = rest[Math.floor((rest.length - 1) * 0.9)];
  if (ref > 0 && max > ref * 3) return { cap: niceCeil(ref * 2), max };
  return null;
}

/** 1, 2, 2.5, 5 × 10^n at or above v. */
function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = [1, 2, 2.5, 5, 10].find(m => m * p >= v) ?? 10;
  return n * p;
}

function ChartTooltip({ active, payload, unit, series, colors }: TooltipProps<number, string> & { unit: ValueUnit; series: SeriesDef[]; colors: string[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as TimePoint;
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
      <p className="mb-1.5 text-fg-muted">{point.full}</p>
      <ul className="space-y-1">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-fg-muted">
              <span className="h-0.5 w-3 rounded-full" style={{ background: colors[i] }} aria-hidden="true" />
              {s.label}
            </span>
            <span className="font-semibold text-fg tabular-nums">{formatValue(Number(point[`__raw_${s.key}`] ?? point[s.key]) || 0, unit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend for 2+ series: a short line key in the series colour, the name in text colour. */
export function SeriesLegend({ series, colors }: { series: SeriesDef[]; colors: string[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full" style={{ background: colors[i] }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Time series per the admin's chart method: one unit, ≤4 series, 2px lines,
 * no dots, horizontal hairline grid, compact fr ticks ("15 k", "1,2 M F"),
 * crosshair tooltip with every series at that date. A single series is
 * drawn as an area wash. An outlier is drawn at the top edge with its real
 * value labelled (never silently clipped); the caller says so under the chart.
 */
export function TimeSeriesChart({ data, series, unit = 'count', height = 240, ariaLabel, colorOffset = 0 }: {
  data: TimePoint[];
  series: SeriesDef[];
  unit?: ValueUnit;
  height?: number;
  ariaLabel: string;
  /** Start further along chart-1..6 (keeps a series' colour stable across charts). */
  colorOffset?: number;
}) {
  const t = useChartTheme();
  const colors = series.map((_, i) => t.series[(i + colorOffset) % t.series.length]);
  const outlier = useMemo(() => outlierCap(data, series), [data, series]);

  // With an outlier, values above the cap are drawn at the cap; raw values stay in the tooltip.
  const plotted = useMemo(() => {
    if (!outlier) return data;
    return data.map(d => {
      const next: TimePoint = { ...d };
      for (const s of series) {
        const v = Number(d[s.key]) || 0;
        if (v > outlier.cap) { next[s.key] = outlier.cap; next[`__raw_${s.key}`] = v; }
      }
      return next;
    });
  }, [data, series, outlier]);

  const capped = outlier
    ? plotted.flatMap(d => series.map((s, i) => ({ s, i })).filter(({ s }) => d[`__raw_${s.key}`] !== undefined).map(({ s, i }) => ({ x: d.label, raw: Number(d[`__raw_${s.key}`]), key: `${d.key}-${s.key}`, color: colors[i] })))
    : [];

  const common = {
    data: plotted,
    margin: { top: outlier ? 22 : 8, right: 12, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={t.grid} />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={{ stroke: t.grid }}
        tick={{ fontSize: 11, fill: t.axis }}
        interval="preserveStartEnd"
        minTickGap={18}
        tickMargin={8}
      />
      <YAxis
        width={unit === 'money' ? 64 : 48}
        tickLine={false}
        axisLine={false}
        tick={{ fontSize: 11, fill: t.axis, style: { fontVariantNumeric: 'tabular-nums' } }}
        tickFormatter={v => formatTick(Number(v), unit)}
        allowDecimals={false}
        domain={outlier ? [0, outlier.cap] : [0, 'auto']}
      />
      <Tooltip
        cursor={{ stroke: t.axis, strokeWidth: 1 }}
        content={<ChartTooltip unit={unit} series={series} colors={colors} />}
        isAnimationActive={false}
      />
      {capped.map(c => (
        <ReferenceDot
          key={c.key}
          x={c.x}
          y={outlier!.cap}
          r={4}
          fill={c.color}
          stroke={t.tooltip.contentStyle.background}
          strokeWidth={2}
          label={c.raw === outlier!.max ? { value: `${formatCompact(c.raw)} (hors échelle)`, position: 'top', fill: t.text, fontSize: 11 } : undefined}
        />
      ))}
    </>
  );

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {series.length === 1 ? (
          <AreaChart {...common}>
            {axes}
            <Area
              type="monotone"
              dataKey={series[0].key}
              name={series[0].label}
              stroke={colors[0]}
              strokeWidth={2}
              fill={colors[0]}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: t.tooltip.contentStyle.background, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {axes}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={colors[i]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, stroke: t.tooltip.contentStyle.background, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
