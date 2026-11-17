import type { ReactNode } from 'react';

/** Two-line cell: main text + muted line. */
export function TwoLines({ main, sub, mono }: { main: ReactNode; sub?: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={mono ? 'truncate font-mono text-sm text-fg' : 'truncate text-sm font-medium text-fg'}>{main}</p>
      {sub && <p className="truncate text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}
