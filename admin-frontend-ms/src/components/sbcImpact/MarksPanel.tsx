import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon } from '@hugeicons/core-free-icons';
import { Badge, Button, Dialog, DialogContent, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ConfirmDialog, DetailList, ErrorState, Notice, formatDateTime, formatNumber, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    getJuryScores, impactErrorMessage, lockJury, readImpactError,
    type Edition, type JuryCriterionDef, type JuryOverview, type MissingScore,
} from '../../services/impactV2Api';
import { unmarkedFinalists, useJury } from './finaleQueries';

const pts = (n: number) => formatNumber(n, 1);

/** One juror's mark for one finalist: per criterion, comment, and every earlier version (§11.1). */
function ScoreDetail({ editionId, cell, criteria, maxTotal, onClose }: {
    editionId: string;
    cell: { jurorUserId: string; jurorName: string; candidateId: string; finalistName: string };
    criteria: JuryCriterionDef[];
    maxTotal: number;
    onClose: () => void;
}) {
    const q = useQuery({ queryKey: ['sbc-impact', 'jury-scores', editionId], queryFn: () => getJuryScores(editionId) });
    const s = q.data?.find(x => x.candidateId === cell.candidateId && x.jurorUserId === cell.jurorUserId);
    const label = (key: string) => criteria.find(c => c.key === key)?.label ?? key;
    const marks = (scores: Record<string, number>) => criteria.map(c => `${c.label} ${pts(scores[c.key] ?? 0)}/${c.max}`).join(' · ');

    return (
        <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
            <DialogContent size="lg" title={`${cell.jurorName} → ${cell.finalistName}`} description="Note du juré, commentaire et historique des corrections.">
                {q.isLoading ? <Skeleton className="h-40 w-full" /> : !s ? (
                    q.isError
                        ? <ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger la note.'))} onRetry={() => void q.refetch()} />
                        : <p className="text-sm text-fg-muted">Ce juré n’a pas encore noté ce finaliste.</p>
                ) : (
                    <div className="space-y-4">
                        {s.jurorRemoved && <Notice tone="warning">Ce juré a été retiré : cette note ne compte plus.</Notice>}
                        <DetailList items={[
                            ...criteria.map(c => [c.label, `${pts(s.scores[c.key] ?? 0)} / ${c.max}`] as [string, string]),
                            ...Object.keys(s.scores).filter(k => !criteria.some(c => c.key === k)).map(k => [label(k), pts(s.scores[k])] as [string, string]),
                            ['Total', <b key="t">{pts(s.total)} / {formatNumber(maxTotal)}</b>],
                            ['Enregistrée le', formatDateTime(s.updatedAt)],
                        ]} />
                        {s.comment && <p className="whitespace-pre-line rounded-panel border border-line px-4 py-3 text-sm text-fg">« {s.comment} »</p>}
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Historique des corrections</p>
                            {s.history.length === 0 ? (
                                <p className="text-sm text-fg-muted">Aucune correction : c’est la première note.</p>
                            ) : (
                                <ol className="divide-y divide-line rounded-panel border border-line text-sm">
                                    {[...s.history].reverse().map((h, i) => (
                                        <li key={i} className="space-y-0.5 px-4 py-2.5">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                <span className="font-medium text-fg">Version remplacée : {pts(h.total)} / {formatNumber(maxTotal)}</span>
                                                <span className="text-xs text-fg-muted">{formatDateTime(h.at)}</span>
                                            </div>
                                            <p className="text-xs text-fg-muted">{marks(h.scores)}</p>
                                            {h.comment && <p className="text-xs text-fg">« {h.comment} »</p>}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Who has not marked whom (lock refused with MISSING_SCORES). */
function MissingList({ missing }: { missing: MissingScore[] }) {
    return (
        <ul className="mt-2 space-y-1">
            {missing.filter(m => m.notScoredBy.length > 0).map(m => (
                <li key={m.candidateId}>
                    <b className="font-medium">{m.name}</b> : {m.scoredBy === 0 ? 'aucune note' : `${formatNumber(m.scoredBy)} note(s)`}
                    {' '}· pas encore noté par {m.notScoredBy.join(', ')}
                </li>
            ))}
        </ul>
    );
}

const averages = (jury: JuryOverview) => {
    const active = jury.jurors.filter(j => !j.removedAt);
    return new Map(jury.finalists.map(f => {
        const totals = active.flatMap(j => j.scores.filter(s => s.candidateId === f._id).map(s => s.total));
        return [f._id, totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null] as const;
    }));
};

/**
 * The jury's marks: jurors × finalists (removed jurors struck through), the
 * detail of a mark with its history, and « Verrouiller les notes ».
 */
export default function MarksPanel({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: (e?: Edition) => void }) {
    const jury = useJury(edition);
    const [cell, setCell] = useState<{ jurorUserId: string; jurorName: string; candidateId: string; finalistName: string } | null>(null);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [missing, setMissing] = useState<{ message: string; missing: MissingScore[] } | null>(null);

    if (jury.isLoading) return <Skeleton className="h-48 w-full" />;
    if (!jury.data) return <Panel><ErrorState error={new Error(impactErrorMessage(jury.error, 'Impossible de charger les notes.'))} onRetry={() => void jury.refetch()} /></Panel>;
    const j = jury.data;
    const locked = !!j.lockedAt;
    const avg = averages(j);
    const unmarked = unmarkedFinalists(j);
    const activeJurors = j.jurors.filter(x => !x.removedAt);
    const incomplete = activeJurors.reduce((n, x) => n + Math.max(0, j.finalists.length - x.scored), 0);

    const askLock = () => setConfirm({
        title: 'Verrouiller les notes du jury ?',
        confirmLabel: 'Verrouiller les notes',
        description: 'C’est définitif : plus aucune note ne pourra être donnée ni corrigée, et le jury ne pourra plus changer. Le résultat se calcule sur ces notes.',
        body: incomplete > 0
            ? <Notice tone="warning">{formatNumber(incomplete)} note(s) manquent encore : un finaliste sans note d’un juré est jugé sur la moyenne des autres jurés.</Notice>
            : undefined,
        onConfirm: async () => {
            setMissing(null);
            try {
                onChanged(await lockJury(edition._id));
                toast.success('Notes du jury verrouillées.');
            } catch (err) {
                const x = readImpactError(err, 'Les notes n’ont pas pu être verrouillées.');
                if (x.code === 'MISSING_SCORES') {
                    setMissing({ message: x.message, missing: Array.isArray(x.details?.missing) ? x.details!.missing as MissingScore[] : [] });
                    toast.error(x.message);
                    void jury.refetch();
                    return;
                }
                throw new Error(x.message);
            }
        },
    });

    return (
        <Panel>
            <PanelHeader
                title={<span className="flex flex-wrap items-center gap-2">Notes du jury{locked && <Badge tone="neutral"><HugeiconsIcon icon={LockIcon} size={12} aria-hidden="true" />Verrouillées le {formatDateTime(j.lockedAt)}</Badge>}</span>}
                description={`Totaux sur ${formatNumber(j.maxTotal)} (${j.criteria.map(c => `${c.label} /${c.max}`).join(', ')}). Cliquez une note pour son détail et son historique.`}
                actions={canWrite && !locked && edition.stage === 'LIVE' ? (
                    <Button variant="danger" size="lg" className="sm:h-9" onClick={askLock}>
                        <HugeiconsIcon icon={LockIcon} size={16} aria-hidden="true" />Verrouiller les notes
                    </Button>
                ) : undefined}
            />
            <PanelBody className="space-y-3">
                {missing && (
                    <Notice tone="danger">
                        <p>{missing.message}</p>
                        <MissingList missing={missing.missing} />
                    </Notice>
                )}
                {!locked && unmarked.length > 0 && edition.stage === 'LIVE' && (
                    <Notice tone="warning">Pas encore noté par tout le jury : {unmarked.map(f => f.name).join(', ')}. Chaque juré doit noter chaque finaliste avant le verrouillage ; retirez un juré qui ne pourra pas noter.</Notice>
                )}
                {j.jurors.length === 0 || j.finalists.length === 0 ? (
                    <p className="text-sm text-fg-muted">Les notes apparaissent ici dès que les jurés notent les finalistes.</p>
                ) : (
                    <div className="overflow-x-auto rounded-panel border border-line">
                        <table className="w-full min-w-[32rem] text-sm">
                            <thead className="bg-surface-2 text-xs text-fg-muted">
                                <tr>
                                    <th scope="col" className="px-3 py-2 text-left font-medium">Juré</th>
                                    {j.finalists.map(f => <th key={f._id} scope="col" className="px-3 py-2 text-right font-medium">{f.name}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {j.jurors.map(r => (
                                    <tr key={r._id} className={cn(r.removedAt && 'text-fg-muted')}>
                                        <th scope="row" className={cn('px-3 py-2 text-left font-medium', r.removedAt && 'line-through')}>
                                            {r.name || 'Juré'}{r.removedAt && <span className="sr-only"> (retiré : ses notes ne comptent plus)</span>}
                                        </th>
                                        {j.finalists.map(f => {
                                            const sc = r.scores.find(x => x.candidateId === f._id);
                                            return (
                                                <td key={f._id} className="px-3 py-1.5 text-right">
                                                    {sc ? (
                                                        <button
                                                            type="button"
                                                            className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 tabular-nums hover:bg-surface-2', r.removedAt && 'line-through')}
                                                            onClick={() => setCell({ jurorUserId: r.userId, jurorName: r.name, candidateId: f._id, finalistName: f.name })}
                                                            aria-label={`Note de ${r.name} pour ${f.name} : ${pts(sc.total)} sur ${j.maxTotal}`}
                                                        >
                                                            {pts(sc.total)}<span className="text-xs text-fg-muted">/{formatNumber(j.maxTotal)}</span>
                                                            {sc.edits > 0 && <Badge tone="info" title="Note corrigée">{sc.edits}×</Badge>}
                                                        </button>
                                                    ) : <span className="text-fg-subtle">—</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-line bg-surface-2 text-xs">
                                <tr>
                                    <th scope="row" className="px-3 py-2 text-left font-medium text-fg-muted">Moyenne (jurés actifs)</th>
                                    {j.finalists.map(f => {
                                        const a = avg.get(f._id);
                                        return <td key={f._id} className="px-3 py-2 text-right font-semibold tabular-nums text-fg">{a == null ? '—' : `${pts(a)}/${formatNumber(j.maxTotal)}`}</td>;
                                    })}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </PanelBody>
            {cell && <ScoreDetail editionId={edition._id} cell={cell} criteria={j.criteria} maxTotal={j.maxTotal} onClose={() => setCell(null)} />}
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Panel>
    );
}
