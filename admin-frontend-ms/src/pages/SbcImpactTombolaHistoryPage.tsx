import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, Ticket01Icon } from '@hugeicons/core-free-icons';
import { EmptyState, PageHeader, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../components/ui';
import { ErrorState, formatDateTime, formatNumber, plural } from '../components/moduleKit';
import { PrizeStatusBadge } from '../components/sbcImpact/shared';
import { getTombolaHistory, impactErrorMessage, type TombolaHistoryRow } from '../services/impactV2Api';

type Row = TombolaHistoryRow['winners'][number] & { key: string; drawId: string; editionId: string; editionName: string | null; drawnAt: string };

/**
 * Every SBC Tombola draw of the SBC Impact Challenge, newest first, one line
 * per prize (§13.2: édition, date, n° du ticket, gagnant, lot, statut). Not
 * the monthly tombola of the « Tombola » module.
 */
export default function SbcImpactTombolaHistoryPage() {
    const q = useQuery({ queryKey: ['sbc-impact', 'tombola-history'], queryFn: getTombolaHistory });
    const draws = q.data ?? [];
    const rows: Row[] = draws.flatMap(d => d.winners.map(w => ({
        ...w, key: `${d.drawId}-${w.order}`, drawId: d.drawId, editionId: d.editionId, editionName: d.editionName, drawnAt: d.drawnAt,
    })));

    const columns: ListColumn<Row>[] = [
        {
            key: 'edition', header: 'Édition', cell: r => (
                <Link to={`/sbc-impact/${r.editionId}?tab=tombola`} className="font-medium text-primary hover:underline" onClick={e => e.stopPropagation()}>
                    {r.editionName ?? 'Édition'}
                </Link>
            ),
        },
        { key: 'date', header: 'Tirage', cell: r => formatDateTime(r.drawnAt) },
        { key: 'ticket', header: 'Ticket', numeric: true, cell: r => (r.ticketNumber == null ? '—' : `n° ${formatNumber(r.ticketNumber)}`) },
        {
            key: 'winner', header: 'Gagnant', cell: r => (r.userId
                ? <Link to={`/userpage/${r.userId}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>{r.displayName ?? 'Membre SBC'}</Link>
                : <span className="text-fg-subtle">—</span>),
        },
        { key: 'prize', header: 'Lot', cell: r => <span>{r.order}. {r.prize}</span> },
        { key: 'status', header: 'Statut', cell: r => <PrizeStatusBadge status={r.status} /> },
        { key: 'note', header: 'Note', cell: r => (r.statusNote ? <span className="line-clamp-2 text-fg-muted" title={r.statusNote}>{r.statusNote}</span> : <span className="text-fg-subtle">—</span>) },
    ];

    return (
        <div className="space-y-6">
            <div>
                <Link to="/sbc-impact" className="inline-flex h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg sm:h-auto">
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Toutes les éditions
                </Link>
                <PageHeader
                    className="mb-0 mt-2"
                    title="Tombola SBC Impact : historique"
                    description="Les tirages de la tombola du SBC Impact Challenge, du plus récent au plus ancien, lot par lot. La tombola mensuelle est dans le module « Tombola »."
                />
            </div>
            <Panel>
                <PanelHeader
                    title="Tirages"
                    description={q.data ? `${formatNumber(draws.length)} ${plural(draws.length, 'tirage')} · ${formatNumber(rows.length)} ${plural(rows.length, 'lot')}` : undefined}
                />
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    rowKey={r => r.key}
                    loading={q.isLoading}
                    className="border-t border-line"
                    empty={q.isError ? (
                        <ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger l’historique des tirages.'))} onRetry={() => void q.refetch()} retrying={q.isFetching} />
                    ) : (
                        <EmptyState icon={Ticket01Icon} title="Aucun tirage pour l’instant" description="Les tirages apparaissent ici une fois effectués." />
                    )}
                />
            </Panel>
        </div>
    );
}
