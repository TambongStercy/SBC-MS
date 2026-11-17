import { useState, type ReactNode } from 'react';
import { ChartBarLineIcon, Table01Icon } from '@hugeicons/core-free-icons';
import { Segmented, Table, TBody, TD, TH, THead, TR, Tooltip } from '../ui';
import { fmtPct } from '../display/format';

export interface BarDatum { key: string; label: string; value: number }

/**
 * Ranked horizontal bars (largest first), one hue (chart-1), on a shared
 * baseline: the parts of one whole compared with each other. Name and figure
 * stay in text colours beside each bar; hover or focus gives the exact value
 * and share. "Tableau" shows the same numbers as a table.
 */
export function RankedBars({ data, format, label, unitHeader = 'Valeur', footer }: {
    data: BarDatum[];
    format: (n: number) => string;
    /** What is compared, for screen readers. */
    label: string;
    unitHeader?: string;
    footer?: ReactNode;
}) {
    const [view, setView] = useState<'chart' | 'table'>('chart');
    const rows = [...data].sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const max = Math.max(...rows.map(r => r.value), 0);
    const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Segmented
                    size="sm"
                    label={`Affichage : ${label}`}
                    value={view}
                    onValueChange={setView}
                    options={[
                        { value: 'chart', label: 'Graphique', icon: ChartBarLineIcon },
                        { value: 'table', label: 'Tableau', icon: Table01Icon },
                    ]}
                />
            </div>

            {view === 'chart' ? (
                <ul className="space-y-3" aria-label={label}>
                    {rows.map(r => {
                        const pct = share(r.value);
                        const width = max > 0 ? (r.value / max) * 100 : 0;
                        return (
                            <li key={r.key}>
                                <Tooltip content={`${r.label} : ${format(r.value)} (${fmtPct(pct)})`}>
                                    <div tabIndex={0} className="group rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label={`${r.label} : ${format(r.value)}, ${fmtPct(pct)}`}>
                                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                                            <span className="min-w-0 truncate text-fg">{r.label}</span>
                                            <span className="shrink-0 tabular-nums text-fg">
                                                {format(r.value)} <span className="text-xs text-fg-muted">· {fmtPct(pct)}</span>
                                            </span>
                                        </div>
                                        <div className="h-3 w-full" aria-hidden="true">
                                            {width > 0 && (
                                                <div
                                                    className="h-3 rounded-r-[4px] bg-chart-1 transition-[filter] group-hover:brightness-110"
                                                    style={{ width: `max(${width}%, 2px)` }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </Tooltip>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <Table>
                    <THead>
                        <tr>
                            <TH>Catégorie</TH>
                            <TH numeric>{unitHeader}</TH>
                            <TH numeric>Part</TH>
                        </tr>
                    </THead>
                    <TBody>
                        {rows.map(r => (
                            <TR key={r.key}>
                                <TD>{r.label}</TD>
                                <TD numeric>{format(r.value)}</TD>
                                <TD numeric>{fmtPct(share(r.value))}</TD>
                            </TR>
                        ))}
                        <TR>
                            <TD className="font-medium">Total</TD>
                            <TD numeric className="font-medium">{format(total)}</TD>
                            <TD numeric className="font-medium">100 %</TD>
                        </TR>
                    </TBody>
                </Table>
            )}
            {footer}
        </div>
    );
}
