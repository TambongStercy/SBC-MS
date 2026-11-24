import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Button, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ErrorState, formatDate, formatNumber, plural } from '../moduleKit';
import {
    createShowcasePages, impactErrorMessage, listShowcase, type Edition,
} from '../../services/impactV2Api';
import { CandidateThumb } from './shared';
import { showcaseResultText } from './showcaseFormat';

/**
 * After the result: the edition's « SBC Impact » pages, and « Créer les pages »
 * for an edition whose pages are missing (its result came before the
 * showcase existed). Creating is idempotent.
 */
export default function ShowcaseBlock({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: () => void }) {
    const q = useQuery({ queryKey: ['sbc-impact', 'showcase', { editionId: edition._id }], queryFn: () => listShowcase({ editionId: edition._id }) });
    const [creating, setCreating] = useState(false);
    const pages = q.data ?? [];
    const expected = edition.result?.rows?.length ?? 0;
    const missing = q.data ? Math.max(0, expected - pages.length) : 0;

    const create = async () => {
        setCreating(true);
        try {
            const { created } = await createShowcasePages(edition._id);
            toast.success(created ? `${formatNumber(created)} ${plural(created, 'page créée', 'pages créées')}.` : 'Toutes les pages existaient déjà.');
            void q.refetch();
            onChanged();
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Les pages n’ont pas pu être créées.'));
        } finally {
            setCreating(false);
        }
    };

    return (
        <Panel>
            <PanelHeader
                title="SBC Impact"
                description="Les pages publiques des finalistes, au moins 12 mois après le résultat."
                actions={(
                    <div className="flex flex-wrap gap-2">
                        {canWrite && (missing > 0 || (q.data && pages.length === 0)) && (
                            <Button variant="primary" size="sm" className="h-11 sm:h-8" onClick={() => void create()} loading={creating}>Créer les pages</Button>
                        )}
                        <Button asChild variant="outline" size="sm" className="h-11 sm:h-8"><Link to="/sbc-impact/vitrine">Toutes les pages</Link></Button>
                    </div>
                )}
            />
            <PanelBody>
                {q.isLoading ? <Skeleton className="h-20 w-full" /> : q.isError ? (
                    <ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger les pages SBC Impact.'))} onRetry={() => void q.refetch()} />
                ) : pages.length === 0 ? (
                    <p className="text-sm text-fg-muted">Aucune page pour cette édition. « Créer les pages » les crée à partir du résultat publié.</p>
                ) : (
                    <ul className="divide-y divide-line rounded-panel border border-line">
                        {pages.map(p => (
                            <li key={p._id}>
                                <Link to={`/sbc-impact/vitrine/${p._id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                                    <span className="flex min-w-0 items-center gap-3">
                                        <CandidateThumb fileId={p.profile.photoFileId} name={p.profile.name} size="sm" />
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium text-fg">{p.profile.name}</span>
                                            <span className="block text-xs text-fg-muted">{showcaseResultText(p.result)} · jusqu’au {formatDate(p.visibleUntil)}</span>
                                        </span>
                                    </span>
                                    <span className="flex flex-wrap gap-1">
                                        {p.result.winner && <Badge tone="success">Gagnant</Badge>}
                                        {(p.hidden ?? !!p.hiddenAt) ? <Badge tone="danger">Masquée</Badge> : p.archived ? <Badge tone="neutral">Archivée</Badge> : null}
                                        {(p.pendingUpdates ?? 0) > 0 && <Badge tone="warning">{formatNumber(p.pendingUpdates)} à valider</Badge>}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </PanelBody>
        </Panel>
    );
}
