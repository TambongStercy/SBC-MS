import type { ReactNode } from 'react';
import { Tooltip } from '../ui';
import { formatMoney, formatNumber, formatPercent } from './format';

export interface RankedBar {
  key: string;
  label: ReactNode;
  value: number;
  /** Optional colour token for status bars (default: chart-1, one hue). */
  color?: string;
}

/**
 * Part-to-whole or comparison as ranked horizontal bars (dataviz: no donut):
 * largest first, one hue, thin bars with a 4px rounded data end, the value
 * and share printed beside each bar, tooltip on hover/focus.
 */
export function RankedBars({ items, kind = 'count', showShare = true, sort = true, emptyText = 'Aucune donnée.' }: {
  items: RankedBar[];
  kind?: 'count' | 'money';
  showShare?: boolean;
  sort?: boolean;
  emptyText?: string;
}) {
  const rows = sort ? [...items].sort((a, b) => b.value - a.value) : items;
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(0, ...rows.map(r => r.value));
  const fmt = (v: number) => (kind === 'money' ? formatMoney(v) : formatNumber(v));
  if (!rows.length || total === 0) return <p className="py-6 text-center text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ul className="space-y-3">
      {rows.map(r => {
        const pct = max ? (r.value / max) * 100 : 0;
        const share = total ? r.value / total : 0;
        return (
          <li key={r.key}>
            <Tooltip content={`${typeof r.label === 'string' ? r.label : ''} : ${fmt(r.value)}${showShare ? ` (${formatPercent(share)})` : ''}`}>
              <div tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-fg">{r.label}</span>
                  <span className="shrink-0 tabular-nums text-fg">
                    {fmt(r.value)}
                    {showShare && <span className="ml-1.5 text-xs text-fg-muted">{formatPercent(share, 0)}</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full" aria-hidden="true">
                  {r.value > 0 && (
                    <div className="h-2 rounded-r-[4px]" style={{ width: `${Math.max(pct, 1)}%`, background: r.color ?? 'var(--chart-1)' }} />
                  )}
                </div>
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
