import { useState } from 'react';
import { Button } from '../ui';

export interface RankedItem {
  key: string;
  label: string;
  value: number;
}

/**
 * Ranked horizontal bars (meter list): name, bar, figure per row, largest
 * first, one hue (chart-1). Every value is printed, so nothing hides behind a
 * hover. Shows `initial` rows, the rest behind "Voir tout".
 */
export function RankedBars({ items, format, initial = 8, ariaLabel }: {
  items: RankedItem[];
  format: (v: number) => string;
  initial?: number;
  ariaLabel: string;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map(i => Math.abs(i.value)));
  const shown = all ? sorted : sorted.slice(0, initial);
  return (
    <div>
      <ul aria-label={ariaLabel} className="space-y-2.5">
        {shown.map(item => {
          const pct = Math.max(0, (item.value / max) * 100);
          return (
            <li key={item.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
              <span className="truncate text-fg-muted" title={item.label}>{item.label}</span>
              <span className="h-3 w-full" aria-hidden="true">
                {pct > 0 && (
                  <span className="block h-3 rounded-r-[4px] bg-chart-1" style={{ width: `max(${pct}%, 2px)` }} />
                )}
              </span>
              <span className="text-right font-medium text-fg tabular-nums">{format(item.value)}</span>
            </li>
          );
        })}
      </ul>
      {sorted.length > initial && (
        <Button variant="ghost" size="sm" className="mt-3 h-11 sm:h-8" onClick={() => setAll(v => !v)}>
          {all ? 'Voir moins' : `Voir les ${sorted.length} pays`}
        </Button>
      )}
    </div>
  );
}
