import { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Award01Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ConfirmDialog, ErrorState, Notice, formatDateTime, formatNumber, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    impactErrorMessage, publishResult, readImpactError, type Edition, type FinalResultRow, type MissingScore,
} from '../../services/impactV2Api';
import { useResult } from './finaleQueries';

type Weights = { paidVotes: number; publicVote: number; jury: number };
const n1 = (v: number) => formatNumber(v, 2);
const place = (rank: number) => (rank === 1 ? '1er' : `${rank}e`);

/** Finalists with the three parts on 100, the weights, the score and the rank. */
function ResultTable({ rows, weights, winnerId }: { rows: FinalResultRow[]; weights: Weights; winnerId?: string }) {
    return (
        <div className="overflow-x-auto rounded-panel border border-line">
            <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-2 text-xs text-fg-muted">
                    <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Rang</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Finaliste</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Votes payants ({weights.paidVotes} %)</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Vote public ({weights.publicVote} %)</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Jury ({weights.jury} %)</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Score /100</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line">
                    {rows.map(r => (
                        <tr key={r.candidateId} className={cn(r.candidateId === winnerId && 'bg-success-soft/40')} data-testid={`result-${r.candidateId}`}>
                            <td className="px-3 py-2 font-semibold tabular-nums">{place(r.rank)}</td>
                            <td className="px-3 py-2">
                                <span className="flex items-center gap-1.5 font-medium text-fg">
                                    {r.name}
                                    {r.candidateId === winnerId && <Badge tone="success"><HugeiconsIcon icon={Award01Icon} size={12} aria-hidden="true" />Gagnant</Badge>}
                                </span>
                                <span className="block text-xs text-fg-muted">{r.projectName}</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                                {n1(r.components.paidVotes)}<span className="block text-xs text-fg-muted">{formatNumber(r.paidVotes)} votes</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                                {n1(r.components.publicVote)}<span className="block text-xs text-fg-muted">{formatNumber(r.finalVotes)} votes</span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                                {n1(r.components.jury)}
                                <span className="block text-xs text-fg-muted">moy. {n1(r.juryAverage)}/{formatNumber(r.juryMax)} · {formatNumber(r.jurorsCount)} juré(s)</span>
                            </td>
                            <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">{n1(r.score)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * The final result (§12): computed live until it is published (blockers,
 * warnings, the formula), then frozen. Publishing needs the admin's code and
 * confirms the order displayed: a result that changed since is reloaded.
 */
export default function ResultPanel({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: (e?: Edition) => void }) {
    const q = useResult(edition, edition.stage === 'LIVE' || edition.stage === 'RESULT');
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    if (q.isLoading) return <Skeleton className="h-56 w-full" />;
    if (!q.data) return <Panel><ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de calculer le résultat.'))} onRetry={() => void q.refetch()} retrying={q.isFetching} /></Panel>;
    const data = q.data;

    if (data.published) {
        const r = data.result;
        return (
            <Panel>
                <PanelHeader title="Résultat publié" description={`Le ${formatDateTime(r.publishedAt)}. Ce résultat est figé.`} />
                <PanelBody className="space-y-3">
                    <ResultTable rows={[...r.rows].sort((a, b) => a.rank - b.rank)} weights={r.weights} winnerId={r.winnerCandidateId} />
                    <p className="text-xs text-fg-muted">{data.formula}</p>
                </PanelBody>
            </Panel>
        );
    }

    const { rows, weights, blockers, warnings, formula } = data;
    const winner = rows[0];
    const blocked = blockers.length > 0 || rows.length === 0;

    const askPublish = () => {
        const shown = rows.map(r => r.candidateId);
        setConfirm({
            title: 'Publier le résultat ?',
            tone: 'primary',
            confirmLabel: 'Publier le résultat',
            description: 'C’est définitif : le gagnant est désigné, chaque finaliste est prévenu, et le résultat s’affiche sur l’écran public. Votre code d’authentification vous sera demandé.',
            body: (
                <div className="space-y-2 text-sm">
                    {winner && (
                        <p className="rounded-panel border border-success/40 bg-success-soft/50 px-3 py-2">
                            <b className="font-semibold">Gagnant : {winner.name}</b> ({n1(winner.score)}/100)
                        </p>
                    )}
                    <ol className="divide-y divide-line rounded-panel border border-line">
                        {rows.map(r => (
                            <li key={r.candidateId} className="flex justify-between gap-3 px-3 py-2">
                                <span><b className="font-semibold">{place(r.rank)}</b> {r.name}</span>
                                <span className="tabular-nums text-fg-muted">{n1(r.score)}/100</span>
                            </li>
                        ))}
                    </ol>
                </div>
            ),
            onConfirm: async () => {
                try {
                    onChanged(await publishResult(edition._id, shown));
                    toast.success(`Résultat publié : ${winner?.name ?? 'le gagnant'} remporte le SBC Impact Challenge.`);
                } catch (err) {
                    const x = readImpactError(err, 'Le résultat n’a pas pu être publié.');
                    if (x.code === 'STALE') {
                        toast.error(x.message);
                        await q.refetch();
                        return;
                    }
                    if (x.code === 'ALREADY_PUBLISHED') {
                        toast.error(x.message);
                        onChanged();
                        return;
                    }
                    throw new Error(x.message);
                }
            },
        });
    };

    return (
        <Panel>
            <PanelHeader
                title="Résultat de la finale"
                description="Calculé à l’instant sur les votes payants figés au TOP 3, le vote public de la finale et la moyenne du jury."
                actions={canWrite ? (
                    <Button variant="primary" size="lg" className="sm:h-9" onClick={askPublish} disabled={blocked}
                        title={blocked ? 'Réglez d’abord les points signalés.' : undefined}>
                        Publier le résultat
                    </Button>
                ) : undefined}
            />
            <PanelBody className="space-y-3">
                {blockers.map(b => {
                    // `details: { missing }`, the same shape as the lock's refusal (an array before).
                    const d = b.details as { missing?: MissingScore[] } | MissingScore[] | undefined;
                    const missing = Array.isArray(d) ? d : d?.missing;
                    return (
                    <Notice key={b.code} tone="warning">
                        <p>{b.message}</p>
                        {b.code === 'MISSING_SCORES' && Array.isArray(missing) && (
                            <ul className="mt-1 space-y-0.5">
                                {missing.filter(m => m.scoredBy === 0 || m.notScoredBy.length > 0).map(m => (
                                    <li key={m.candidateId}>{m.name} : pas encore noté par {m.notScoredBy.join(', ') || 'aucun juré actif'}</li>
                                ))}
                            </ul>
                        )}
                    </Notice>
                    );
                })}
                {warnings.map(w => <Notice key={w} tone="info">{w}</Notice>)}
                {rows.length > 0 && <ResultTable rows={rows} weights={weights} />}
                <p className="text-xs text-fg-muted">{formula}</p>
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => void q.refetch()} loading={q.isFetching}>Recalculer</Button>
                </div>
            </PanelBody>
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Panel>
    );
}
