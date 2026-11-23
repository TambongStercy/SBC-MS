import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Award01Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, EmptyState, Panel, PanelBody, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../ui';
import { ConfirmDialog, ErrorState, Money, Notice, formatDateTime, formatNumber, plural, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import { decideTop3, getTop3, impactErrorMessage, readImpactError, type Edition, type Top3Row } from '../../services/impactV2Api';

const place = (rank: number) => (rank === 1 ? '1er' : `${rank}e`);

/** The podium as decided: frozen on the edition, with the names stored at the decision. */
function FrozenTop3({ edition }: { edition: Edition }) {
    const ranking = [...(edition.top3?.ranking ?? [])].sort((a, b) => a.rank - b.rank);
    return (
        <Panel>
            <PanelHeader
                title="TOP 3 désigné"
                description={`Le ${formatDateTime(edition.top3?.decidedAt)}. Ce classement est figé : les votes et les remboursements ne le changent plus.`}
            />
            <PanelBody>
                <ol className="divide-y divide-line rounded-panel border border-line">
                    {ranking.map(r => (
                        <li key={r.candidateId} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3', r.finalist && 'bg-success-soft/40')}>
                            <span className="flex min-w-0 items-center gap-3">
                                <span className="w-10 shrink-0 font-semibold tabular-nums text-fg">{place(r.rank)}</span>
                                <span className="min-w-0">
                                    <span className="block truncate font-medium text-fg">
                                        {r.name ?? `…${r.candidateId.slice(-6)}`}{r.seatNumber ? <span className="font-normal text-fg-muted"> · n° {r.seatNumber}</span> : null}
                                    </span>
                                    {r.projectName && <span className="block truncate text-xs text-fg-muted">{r.projectName}</span>}
                                </span>
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center gap-2">
                                <span className="tabular-nums text-fg">{formatNumber(r.paidVotes)} {plural(r.paidVotes, 'vote payant', 'votes payants')}</span>
                                {r.freeVotes != null && <span className="tabular-nums text-xs text-fg-muted">{formatNumber(r.freeVotes)} gratuits</span>}
                                {r.finalist && <Badge tone="success"><HugeiconsIcon icon={Award01Icon} size={12} aria-hidden="true" />Finaliste</Badge>}
                            </span>
                        </li>
                    ))}
                </ol>
            </PanelBody>
        </Panel>
    );
}

/**
 * The TOP 3 (spec §9): the ranking by week-3 paid votes, what blocks the
 * decision, and « Désigner le TOP 3 » (admin code), which confirms the order
 * displayed: a ranking that moved since is refused and reloaded.
 */
export default function Top3Tab({ edition, canWrite, onChanged, onOpenCandidate }: {
    edition: Edition;
    canWrite: boolean;
    onChanged: (e?: Edition) => void;
    onOpenCandidate: (id: string) => void;
}) {
    const decided = !!edition.top3?.decidedAt;
    const ready = edition.status === 'COMPETITION' && edition.stage === 'WEEK3';
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [recounting, setRecounting] = useState(false);
    const queryClient = useQueryClient();
    const key = ['sbc-impact', 'top3', edition._id];
    // A plain read: the counters as the job keeps them (recounted every 5 min).
    const q = useQuery({ queryKey: key, queryFn: () => getTop3(edition._id), enabled: ready && !decided });

    /** « Recompter »: the server recounts the votes from the ledgers, then answers. */
    const recount = async () => {
        setRecounting(true);
        try {
            queryClient.setQueryData(key, await getTop3(edition._id, { recount: true }));
            toast.success('Votes recomptés.');
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Le recomptage a échoué.'));
        } finally {
            setRecounting(false);
        }
    };

    if (decided) return <FrozenTop3 edition={edition} />;
    if (!ready) {
        return (
            <Panel>
                <EmptyState icon={Award01Icon} title="Le TOP 3 se désigne en fin de semaine 3"
                    description="Le classement se fait sur les votes payants de la semaine 3 uniquement." />
            </Panel>
        );
    }
    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!q.data) return <Panel><ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger le classement.'))} onRetry={() => void q.refetch()} retrying={q.isFetching} /></Panel>;

    const { ranking, blockers, tieAtCut, flaggedPurchases, finalistsCount } = q.data;
    const finalists = ranking.filter(r => r.finalist);
    const blocked = blockers.length > 0 || ranking.length === 0;

    const askDecide = () => {
        const shown = ranking.map(r => r.candidateId);
        setConfirm({
            title: `Désigner le TOP ${finalistsCount} ?`,
            tone: 'primary',
            confirmLabel: `Désigner le TOP ${finalistsCount}`,
            description: 'C’est définitif : le classement est figé, chaque candidat est prévenu (finaliste ou non), et aucun achat ne peut plus être remboursé. Votre code d’authentification vous sera demandé.',
            body: (
                <ol className="divide-y divide-line rounded-panel border border-line text-sm">
                    {finalists.map(r => (
                        <li key={r.candidateId} className="flex justify-between gap-3 px-3 py-2">
                            <span><b className="font-semibold">{place(r.rank)}</b> {r.name ?? `…${r.candidateId.slice(-6)}`}</span>
                            <span className="tabular-nums text-fg-muted">{formatNumber(r.paidVotes)} {plural(r.paidVotes, 'vote')}</span>
                        </li>
                    ))}
                </ol>
            ),
            onConfirm: async () => {
                try {
                    const res = await decideTop3(edition._id, shown);
                    toast.success(`TOP ${finalistsCount} désigné.`);
                    onChanged(res.edition);
                } catch (err) {
                    const x = readImpactError(err, 'Le TOP 3 n’a pas pu être désigné.');
                    if (x.code === 'STALE') {
                        toast.error(x.message);
                        await q.refetch();
                        return;
                    }
                    if (x.code === 'ALREADY_DECIDED') {
                        toast.error(x.message);
                        onChanged();
                        return;
                    }
                    throw new Error(x.message);
                }
            },
        });
    };

    const columns: ListColumn<Top3Row>[] = [
        { key: 'rank', header: 'Rang', cell: r => <span className="font-semibold tabular-nums">{place(r.rank)}</span> },
        {
            key: 'who', header: 'Candidat', cell: r => (
                <button type="button" className="min-w-0 text-left" onClick={e => { e.stopPropagation(); onOpenCandidate(r.candidateId); }}>
                    <span className="block truncate font-medium text-fg hover:underline">{r.name ?? `…${r.candidateId.slice(-6)}`}{r.seatNumber ? <span className="text-fg-muted"> · n° {r.seatNumber}</span> : null}</span>
                    <span className="block truncate text-xs text-fg-muted">{r.projectName}</span>
                </button>
            ),
        },
        { key: 'paid', header: 'Votes payants', numeric: true, cell: r => <span className="font-medium">{formatNumber(r.paidVotes)}</span> },
        { key: 'amount', header: 'Montant', numeric: true, cell: r => (r.paidAmount == null ? '—' : <Money value={r.paidAmount} />) },
        { key: 'free', header: 'Votes gratuits', numeric: true, cell: r => (r.freeVotes == null ? '—' : formatNumber(r.freeVotes)) },
        { key: 'reached', header: 'Total atteint le', cell: r => (r.lastPaidAt ? formatDateTime(r.lastPaidAt) : '—') },
        { key: 'finalist', header: 'Résultat', cell: r => (r.finalist ? <Badge tone="success">Finaliste</Badge> : <span className="text-fg-subtle">—</span>) },
    ];

    return (
        <div className="space-y-4">
            {blockers.map(b => (
                <Notice key={b.code} tone="warning">
                    {b.message}{b.until ? <> Fin du délai : <b className="font-semibold">{formatDateTime(b.until)}</b>.</> : null}
                </Notice>
            ))}
            {tieAtCut && (
                <Notice tone="info">
                    Égalité de votes à la limite du TOP {finalistsCount}. Règle : à égalité, passe le candidat qui a atteint ce total le premier
                    (heure de son dernier vote compté), puis la place obtenue la plus ancienne. Le classement ci-dessous l’applique déjà.
                </Notice>
            )}
            {flaggedPurchases > 0 && (
                <Notice tone="warning">
                    {formatNumber(flaggedPurchases)} {plural(flaggedPurchases, 'achat payé est signalé', 'achats payés sont signalés')} : vérifiez-les dans « Votes » avant de désigner le TOP 3.
                </Notice>
            )}

            <Panel>
                <PanelHeader
                    title="Classement aux votes payants"
                    description={`Votes payants confirmés, recomptés automatiquement toutes les 5 minutes (et à la désignation). Les ${finalistsCount} premiers sont finalistes.`}
                    actions={canWrite ? (
                        <Button variant="primary" size="lg" onClick={askDecide} disabled={blocked}
                            title={blocked ? 'Réglez d’abord les points signalés ci-dessus.' : undefined}>
                            Désigner le TOP {finalistsCount}
                        </Button>
                    ) : undefined}
                />
                <div className={q.isFetching || recounting ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={ranking}
                        columns={columns}
                        rowKey={r => r.candidateId}
                        className="border-t border-line"
                        empty={<EmptyState icon={Award01Icon} title="Aucun candidat en course" />}
                    />
                </div>
                <div className="flex justify-end border-t border-line px-5 py-3">
                    <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => void recount()} loading={recounting}>Recompter</Button>
                </div>
            </Panel>

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
