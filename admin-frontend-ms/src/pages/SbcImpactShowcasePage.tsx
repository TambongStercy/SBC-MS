import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, Award01Icon, StarIcon } from '@hugeicons/core-free-icons';
import { usePermission } from '../hooks/usePermission';
import { Badge, EmptyState, PageHeader, Panel, PanelBody, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../components/ui';
import {
    ConfirmDialog, ErrorState, FilterSelect, formatDate, formatNumber, plural, type ConfirmOptions,
} from '../components/moduleKit';
import ShowcaseUpdateCard from '../components/sbcImpact/ShowcaseUpdateCard';
import { CandidateThumb } from '../components/sbcImpact/shared';
import { showcaseResultText } from '../components/sbcImpact/showcaseFormat';
import {
    impactErrorMessage, listEditions, listPendingShowcaseUpdates, listShowcase, type ShowcasePage,
} from '../services/impactV2Api';

/** Visibility badges: hidden (reason), archived (past its end date), or on show. */
function Visibility({ p }: { p: ShowcasePage }) {
    if (p.hidden ?? !!p.hiddenAt) return <Badge tone="danger" title={p.hiddenReason ?? undefined}>Masquée</Badge>;
    if (p.archived) return <Badge tone="neutral">Archivée</Badge>;
    return <Badge tone="success">En ligne</Badge>;
}

/**
 * « SBC Impact » (spec §14): the finalists' pages after the final, for at
 * least 12 months, and the finalists' news waiting for validation.
 */
export default function SbcImpactShowcasePage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canWrite = usePermission('impactChallenge') === 'write';
    const [editionId, setEditionId] = useState('');
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const pages = useQuery({ queryKey: ['sbc-impact', 'showcase', { editionId }], queryFn: () => listShowcase({ editionId: editionId || undefined }) });
    const queue = useQuery({ queryKey: ['sbc-impact', 'showcase-pending'], queryFn: listPendingShowcaseUpdates });
    const editions = useQuery({ queryKey: ['sbc-impact', 'editions'], queryFn: listEditions });
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['sbc-impact'] }); };
    const rows = pages.data ?? [];
    const pending = queue.data ?? [];
    const open = (p: ShowcasePage) => navigate(`/sbc-impact/vitrine/${p._id}`);

    const columns: ListColumn<ShowcasePage>[] = [
        {
            key: 'who', header: 'Finaliste', cell: p => (
                <div className="flex min-w-0 items-center gap-3">
                    <CandidateThumb fileId={p.profile.photoFileId} name={p.profile.name} />
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{p.profile.name}</p>
                        <p className="truncate text-xs text-fg-muted">{p.profile.projectName}</p>
                    </div>
                </div>
            ),
        },
        { key: 'edition', header: 'Édition', cell: p => p.result.editionName },
        {
            key: 'result', header: 'Résultat', cell: p => (
                <span className="inline-flex flex-wrap items-center gap-1">
                    {p.result.winner && <Badge tone="success"><HugeiconsIcon icon={Award01Icon} size={12} aria-hidden="true" />Gagnant</Badge>}
                    <span className="tabular-nums">{showcaseResultText(p.result)}</span>
                </span>
            ),
        },
        { key: 'until', header: 'Visible jusqu’au', cell: p => formatDate(p.visibleUntil) },
        {
            key: 'state', header: 'État', cell: p => (
                <span className="inline-flex flex-wrap items-center gap-1">
                    <Visibility p={p} />
                    {(p.pendingUpdates ?? 0) > 0 && <Badge tone="warning">{formatNumber(p.pendingUpdates)} {plural(p.pendingUpdates!, 'nouvelle')} à valider</Badge>}
                </span>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <Link to="/sbc-impact" className="inline-flex h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg sm:h-auto">
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Toutes les éditions
                </Link>
                <PageHeader
                    className="mb-0 mt-2"
                    title="SBC Impact"
                    description="Après la finale, chaque finaliste garde une page publique au moins 12 mois : profil, projet, résultat, vidéo, podcast, liens et nouvelles du projet."
                />
            </div>

            <Panel>
                <PanelHeader
                    title="Nouvelles à valider"
                    description={queue.data ? (pending.length ? `${formatNumber(pending.length)} ${plural(pending.length, 'nouvelle')} proposée${pending.length > 1 ? 's' : ''} par les finalistes, la plus ancienne d’abord.` : 'Aucune nouvelle en attente.') : undefined}
                />
                <PanelBody className="space-y-3">
                    {queue.isLoading ? <Skeleton className="h-24 w-full" /> : queue.isError ? (
                        <ErrorState error={new Error(impactErrorMessage(queue.error, 'Impossible de charger les nouvelles à valider.'))} onRetry={() => void queue.refetch()} />
                    ) : pending.map(u => (
                        <div key={u._id} className="space-y-1">
                            <ShowcaseUpdateCard u={u} finalist={u.finalist} canWrite={canWrite} ask={setConfirm} onChanged={refresh} />
                            <Link to={`/sbc-impact/vitrine/${u.showcaseId}`} className="text-xs text-primary hover:underline">Ouvrir la page</Link>
                        </div>
                    ))}
                </PanelBody>
            </Panel>

            <Panel>
                <PanelHeader
                    title="Pages"
                    description={pages.data ? `${formatNumber(rows.length)} ${plural(rows.length, 'page')}` : undefined}
                    actions={(
                        <FilterSelect className="w-56" label="Édition" allLabel="Toutes les éditions" value={editionId} onChange={setEditionId}
                            options={(editions.data ?? []).filter(e => e.status === 'FINISHED' || e.result).map(e => ({ value: e._id, label: e.name }))} />
                    )}
                />
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    rowKey={p => p._id}
                    onRowClick={open}
                    loading={pages.isLoading}
                    className="border-t border-line"
                    empty={pages.isError ? (
                        <ErrorState error={new Error(impactErrorMessage(pages.error, 'Impossible de charger les pages SBC Impact.'))} onRetry={() => void pages.refetch()} retrying={pages.isFetching} />
                    ) : (
                        <EmptyState icon={StarIcon} title="Aucune page pour l’instant" description="Les pages se créent à la publication du résultat de la finale." />
                    )}
                />
            </Panel>

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
