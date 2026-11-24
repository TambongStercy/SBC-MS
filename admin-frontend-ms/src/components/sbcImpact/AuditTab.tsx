import { useInfiniteQuery } from '@tanstack/react-query';
import { CheckListIcon } from '@hugeicons/core-free-icons';
import { Button, EmptyState, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, formatNumber, plural } from '../moduleKit';
import {
    actorLabel, auditActionLabel, impactErrorMessage, listEditionAudit, type AuditEntry,
} from '../../services/impactV2Api';

const PAGE = 50;

type Cursor = { before: string; beforeId: string } | null;

/**
 * The edition's audit trail, newest first. « Charger plus » sends the last entry
 * shown (`at` + `_id`), so lines written in the same millisecond are never skipped.
 */
export default function AuditTab({ editionId, onOpenCandidate }: { editionId: string; onOpenCandidate: (id: string) => void }) {
    const audit = useInfiniteQuery({
        queryKey: ['sbc-impact', 'audit', editionId],
        queryFn: ({ pageParam }) => listEditionAudit(editionId, { limit: PAGE, ...(pageParam ?? {}) }),
        initialPageParam: null as Cursor,
        getNextPageParam: (last): Cursor | undefined => {
            const end = last[last.length - 1];
            return last.length === PAGE && end ? { before: end.at, beforeId: end._id } : undefined;
        },
    });
    const rows = audit.data?.pages.flat() ?? [];

    const columns: ListColumn<AuditEntry>[] = [
        { key: 'action', header: 'Action', cell: a => <span className="font-medium text-fg">{auditActionLabel(a.action)}</span> },
        { key: 'actor', header: 'Par', cell: a => actorLabel(a) },
        { key: 'reason', header: 'Raison', cell: a => (a.reason ? <span className="line-clamp-2 text-fg">{a.reason}</span> : <span className="text-fg-subtle">—</span>) },
        {
            key: 'candidate', header: 'Candidat', cell: a => (a.candidateId ? (
                <Button variant="link" size="sm" className="h-auto" onClick={ev => { ev.stopPropagation(); onOpenCandidate(a.candidateId!); }}>
                    Voir le candidat
                </Button>
            ) : <span className="text-fg-subtle">—</span>),
        },
        { key: 'at', header: 'Date', cell: a => <DateText value={a.at} /> },
    ];

    return (
        <Panel>
            <PanelHeader
                title="Journal"
                description={audit.data ? `${formatNumber(rows.length)} ${plural(rows.length, 'action')} affichée${rows.length > 1 ? 's' : ''}, de la plus récente à la plus ancienne.` : 'Toutes les actions sur l’édition et ses candidats.'}
            />
            <ResponsiveList
                rows={rows}
                columns={columns}
                rowKey={a => a._id}
                loading={audit.isLoading}
                className="border-t border-line"
                empty={audit.isError ? (
                    <ErrorState error={new Error(impactErrorMessage(audit.error, 'Impossible de charger le journal.'))} onRetry={() => void audit.refetch()} retrying={audit.isFetching} />
                ) : (
                    <EmptyState icon={CheckListIcon} title="Aucune action pour l’instant" />
                )}
            />
            {audit.hasNextPage && (
                <div className="flex justify-center border-t border-line p-4">
                    <Button size="lg" onClick={() => void audit.fetchNextPage()} loading={audit.isFetchingNextPage}>Charger plus</Button>
                </div>
            )}
            {audit.isFetchNextPageError && (
                <p className="px-5 pb-4 text-center text-sm text-danger">{impactErrorMessage(audit.error, 'La suite du journal n’a pas pu être chargée.')}</p>
            )}
        </Panel>
    );
}
