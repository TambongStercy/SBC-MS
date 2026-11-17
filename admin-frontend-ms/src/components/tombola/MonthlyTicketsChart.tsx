import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChartLineData01Icon, Table01Icon } from '@hugeicons/core-free-icons';
import { useChartTheme } from '../../hooks/useChartTheme';
import type { TombolaMonth } from '../../services/adminTombolaApi';
import type { DateRange } from '../../lib/period';
import { Button, Table, TBody, TD, TH, THead, TR } from '../ui';
import { formatCompact, formatNumber } from '../moduleKit';
import { monthTitle } from './labels';

const key = (y: number, m: number) => y * 12 + (m - 1);

/**
 * Tickets sold per monthly tombola, over the page's period (dataviz method:
 * one measure, thin columns with a 4px rounded top, one hue, horizontal
 * hairline grid, compact ticks, tooltip on each column, table view).
 * There is one tombola per month, so the finest grain is the month: a period
 * of one month shows its figure instead of a one-column chart.
 * "Toute la période" runs from the oldest tombola to this month (24 months at most).
 */
export function MonthlyTicketsChart({ tombolas, range }: { tombolas: TombolaMonth[]; range: DateRange }) {
  const chart = useChartTheme();
  const [asTable, setAsTable] = useState(false);

  const data = useMemo(() => {
    const now = new Date();
    const byKey = new Map(tombolas.map(t => [key(t.year, t.month), t.lastTicketNumber ?? 0]));
    let end = range.to ? key(range.to.getFullYear(), range.to.getMonth() + 1) : key(now.getFullYear(), now.getMonth() + 1);
    end = Math.min(end, key(now.getFullYear(), now.getMonth() + 1));
    const oldest = tombolas.length ? Math.min(...tombolas.map(t => key(t.year, t.month))) : end;
    let start = range.from ? key(range.from.getFullYear(), range.from.getMonth() + 1) : oldest;
    start = Math.max(start, end - 23);
    const out: { k: number; label: string; full: string; value: number }[] = [];
    for (let k = start; k <= end; k++) {
      const y = Math.floor(k / 12), m = (k % 12) + 1;
      const d = new Date(y, m - 1, 1);
      out.push({ k, label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') + (start < key(now.getFullYear(), 1) ? ` ${String(y).slice(2)}` : ''), full: monthTitle(m, y), value: byKey.get(k) ?? 0 });
    }
    return out;
  }, [tombolas, range]);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-2 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Tickets vendus par mois</h2>
          <p className="mt-0.5 text-xs text-fg-muted"><span className="font-medium text-fg">{formatNumber(total)}</span> tickets sur la période</p>
        </div>
        {data.length > 1 && (
          <Button variant="ghost" size="sm" className="h-9 self-start" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}>
            <HugeiconsIcon icon={asTable ? ChartLineData01Icon : Table01Icon} size={16} aria-hidden="true" />
            {asTable ? 'Voir le graphique' : 'Voir les données'}
          </Button>
        )}
      </div>
      {data.length <= 1 ? (
        <p className="px-4 pb-5 text-sm text-fg-muted sm:px-5">
          {data[0] ? <>{data[0].full} : <span className="font-medium tabular-nums text-fg">{formatNumber(data[0].value)}</span> tickets. </> : null}
          Une seule tombola par mois : choisissez une période plus longue pour voir l’évolution.
        </p>
      ) : total === 0 && !asTable ? (
        <p className="flex h-48 items-center justify-center px-4 text-sm text-fg-muted">Aucun ticket vendu sur la période.</p>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto px-1 pb-2">
          <Table>
            <THead><tr><TH>Mois</TH><TH numeric>Tickets vendus</TH></tr></THead>
            <TBody>{[...data].reverse().map(d => <TR key={d.k}><TD>{d.full}</TD><TD numeric>{formatNumber(d.value)}</TD></TR>)}</TBody>
          </Table>
        </div>
      ) : (
        <div className="h-60 px-2 pb-3" role="img" aria-label={`Tickets vendus par mois : ${formatNumber(total)} sur la période`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={chart.grid} />
              <XAxis dataKey="label" tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: chart.grid }} interval="preserveStartEnd" minTickGap={6} />
              <YAxis tick={{ fill: chart.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={formatCompact} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: chart.cursor }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { full: string; value: number };
                  return (
                    <div style={chart.tooltip.contentStyle} className="px-3 py-2">
                      <div className="text-sm font-semibold tabular-nums">{formatNumber(d.value)} tickets</div>
                      <div className="mt-0.5 text-xs" style={{ color: chart.text }}>{d.full}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" fill={chart.series[0]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
