import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
    FRAUD_SIGNAL_LABELS, VOTING_MODE_LABELS, apiErrorCode, cancelAnimationChallenge, freezeAnimationResult, getAnimationChallenge,
    resumeAnimationChallenge, suspendAnimationChallenge, type AnimChallenge, type BoardEntry, type ChallengeStatus,
} from '../../../api/animation';
import {
    Badge, Button, Card, ConfirmSheet, DataList, ErrorState, IconButton, KeyValue, SectionTitle, Sheet, Spinner, Stat, StatusBadge, notify, type Column,
} from '../../../ui';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { ExportButtons } from './Exports';
import {
    CHALLENGE_STATUS, EVENT_STATUS_LABELS, FLAG_STATUS, FREEZE_BLOCK_SCORE, FREEZE_ERRORS, PERIOD_LABELS, RESULT_STATUS,
    SCOPE_LABELS, SCORING_LABELS, TIE_RULE_LABELS, flagSubjectKind, useAnimRefresh,
} from './shared';

const isFinal = (s: ChallengeStatus) => s === 'COMPLETED' || s === 'CANCELLED';
type Action = 'suspend' | 'resume' | 'cancel' | 'freeze';

const word = (table: Record<string, string>, v?: string) => (v ? table[v] ?? '—' : '—');

function config(c: AnimChallenge): Array<[string, string]> {
    const v = c.voting, f = v?.free, s = c.schedule, p = c.participation;
    return [
        ['Mode de vote', word(VOTING_MODE_LABELS, v?.mode)],
        ['Votants', word(SCOPE_LABELS, v?.voterScope)],
        ...(f ? [['Votes gratuits', `${f.perPeriod} ${PERIOD_LABELS[f.period] ?? ''}${f.perCandidatePerPeriod ? `, max ${f.perCandidatePerPeriod} / candidat` : ''}${f.totalPerChallenge ? `, plafond ${f.totalPerChallenge}` : ''}`] as [string, string]] : []),
        ['Vote pour soi-même', v?.selfVoteAllowed ? 'Autorisé' : 'Interdit'],
        ['Classement', c.scoring ? `${word(SCORING_LABELS, c.scoring.method)}${c.scoring.method === 'HYBRID' ? ` (public ${c.scoring.publicWeight} % / jury ${c.scoring.juryWeight} %)` : ''}` : '—'],
        ['Égalité', word(TIE_RULE_LABELS, c.tieRule)],
        ['Participation', p ? `${word(SCOPE_LABELS, p.mode)}, max ${formatNumber(p.maxCandidates)}${p.requiresApproval ? ', validation requise' : ''}` : '—'],
        ['Compteurs affichés au public', v?.showVoteCounts ? 'Oui' : 'Non'],
        ['Inscriptions', `${formatDateTime(s?.registrationOpensAt)} → ${formatDateTime(s?.registrationClosesAt)}`],
        ['Votes', `${formatDateTime(s?.votingOpensAt)} → ${formatDateTime(s?.votingClosesAt)}`],
        ['Délai de règlement des paiements', s?.settlementGraceMin !== undefined ? `${s.settlementGraceMin} min` : '—'],
        ['Créé le', formatDateTime(c.createdAt)],
    ];
}

const boardCols: Column<BoardEntry>[] = [
    { key: 'r', header: 'Rang', cell: e => <b>{e.rank}</b> },
    { key: 'n', header: 'Candidat', cell: e => <span><span className="font-semibold">{e.displayName}</span> <span className="text-ink-3">n°{e.number}</span></span> },
    { key: 'k', header: 'Catégorie', cell: e => e.category || '—' },
    { key: 'f', header: 'Gratuits', align: 'right', cell: e => formatNumber(e.freeVotes) },
    { key: 'p', header: 'Payants', align: 'right', cell: e => formatNumber(e.paidVotes) },
    { key: 't', header: 'Total', align: 'right', cell: e => formatNumber(e.totalVotes) },
    { key: 's', header: 'Score', align: 'right', cell: e => (typeof e.score === 'number' ? formatNumber(Math.round(e.score * 100) / 100) : '—') },
];

/**
 * One challenge for SBC: configuration, counters, result, live board (real
 * counts even when hidden from the public), fraud flags, exports, and the
 * suspend / resume / cancel / freeze actions.
 */
export function ChallengeSheet({ id, onClose }: { id: string; onClose: () => void }) {
    const refresh = useAnimRefresh();
    const [action, setAction] = useState<Action | null>(null);
    const [freezeError, setFreezeError] = useState<{ code?: string; message: string } | null>(null);
    const q = useQuery({ queryKey: ['animation', 'challenge', id], queryFn: () => getAnimationChallenge(id) });
    const d = q.data;
    const c = d?.challenge;
    const openFlags = d?.flags.filter(f => f.status === 'OPEN') ?? [];

    const done = (msg: string) => { notify.success(msg); refresh(); };

    return (
        <Sheet open onClose={onClose} size="lg"
            title={<span className="block min-w-0"><span className="block truncate">{c?.name ?? 'Défi'}</span>
                {d?.event && <span className="block text-sm font-normal text-ink-2 truncate">{d.event.title}{d.event.status ? ` · ${EVENT_STATUS_LABELS[d.event.status] ?? ''}` : ''}</span>}</span>}
            footer={c && !isFinal(c.status) ? (
                <div className="grid grid-cols-2 gap-2">
                    {c.status === 'RESULTS_PENDING' && <Button variant="success" className="col-span-2" onClick={() => setAction('freeze')}>Figer le résultat…</Button>}
                    {c.suspendedAt
                        ? <Button variant="secondary" onClick={() => setAction('resume')}>Reprendre…</Button>
                        : <Button variant="secondary" onClick={() => setAction('suspend')}>Suspendre…</Button>}
                    <Button variant="danger-soft" onClick={() => setAction('cancel')}>Annuler le défi…</Button>
                </div>
            ) : undefined}>
            {q.isLoading ? <Spinner /> : q.isError || !d || !c ? <ErrorState message="Défi introuvable ou impossible à charger." onRetry={() => q.refetch()} /> : (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={c.status} labels={CHALLENGE_STATUS} />
                        {c.suspendedAt && <Badge tone="danger">Suspendu le {formatDateTime(c.suspendedAt)}</Badge>}
                        {openFlags.length > 0 && <Badge tone="warning">{openFlags.length} signalement{openFlags.length > 1 ? 's' : ''} ouvert{openFlags.length > 1 ? 's' : ''}</Badge>}
                        <IconButton label="Recharger" className="ml-auto size-8" onClick={() => q.refetch()}><RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} /></IconButton>
                    </div>
                    {c.suspendedAt && c.suspendedReason && (
                        <p className="text-sm rounded-tile bg-danger-soft text-ink px-3 py-2"><b>Motif de suspension :</b> {c.suspendedReason}</p>
                    )}
                    {c.cancellation && (
                        <p className="text-sm rounded-tile bg-surface-2 text-ink px-3 py-2">
                            Annulé le {formatDateTime(c.cancellation.at)} — {c.cancellation.reason} ({formatNumber(c.cancellation.refundedTransactions)} achat{c.cancellation.refundedTransactions > 1 ? 's' : ''} remboursé{c.cancellation.refundedTransactions > 1 ? 's' : ''})
                        </p>
                    )}
                    {freezeError && (
                        <p className="text-sm rounded-tile bg-warning-soft text-ink px-3 py-2" role="alert">
                            {freezeError.message}
                            {freezeError.code === 'FRAUD_REVIEW_PENDING' && <> <Link to="?onglet=a-verifier" className="font-semibold text-primary underline">Ouvrir « À vérifier »</Link></>}
                        </p>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Stat label="Candidats" value={`${formatNumber(c.counters.approved)} / ${formatNumber(c.counters.candidates)}`} hint="approuvés / total" />
                        <Stat label="Votes gratuits" value={formatNumber(c.counters.freeVotes)} />
                        <Stat label="Votes payants" value={formatNumber(c.counters.paidVotes)} hint={`${formatNumber(c.counters.paidTransactions)} achat${c.counters.paidTransactions > 1 ? 's' : ''}`} />
                        <Stat label="Revenus" value={formatMoney(c.counters.paidRevenue)} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                        <Link to={`?onglet=votes&defi=${c._id}`} className="text-primary">Voir ses votes payants</Link>
                        <Link to={`?onglet=journal&defi=${c._id}`} className="text-primary">Voir son journal</Link>
                    </div>

                    <section>
                        <SectionTitle>Configuration</SectionTitle>
                        <KeyValue items={config(c)} />
                    </section>

                    <section>
                        <SectionTitle>Résultat</SectionTitle>
                        <Card>
                            {!d.result ? <p className="text-sm text-ink-3">Pas encore calculé (le résultat est calculé à la clôture des votes).</p> : (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap gap-1.5">
                                        <StatusBadge status={d.result.status} labels={RESULT_STATUS} />
                                        {d.result.publishedAt && <Badge tone="success">Publié</Badge>}
                                    </div>
                                    <KeyValue items={[
                                        ['Calculé le', formatDateTime(d.result.computedAt)],
                                        d.result.frozenAt ? ['Figé le', formatDateTime(d.result.frozenAt)] : null,
                                        d.result.publishedAt ? ['Publié le', formatDateTime(d.result.publishedAt)] : null,
                                    ]} />
                                    {d.result.ties?.length > 0 && (
                                        <p className="text-sm text-warning">Égalité{d.result.ties.length > 1 ? 's' : ''} au{d.result.ties.length > 1 ? 'x' : ''} rang{d.result.ties.length > 1 ? 's' : ''} : {d.result.ties.map(t => `${t.rank} (${t.candidateIds.length} candidats)`).join(', ')}</p>
                                    )}
                                    <p className="text-xs text-ink-3 break-all">Empreinte de contrôle : {d.result.inputsHash}</p>
                                </div>
                            )}
                        </Card>
                    </section>

                    <section>
                        <SectionTitle>Classement en direct (top 20)</SectionTitle>
                        {d.board && <p className="text-xs text-ink-3 mb-2">{formatNumber(d.board.totals.candidates)} candidats classés · {formatNumber(d.board.totals.votes)} votes comptés{d.board.computedAt ? ` · ${formatDateTime(d.board.computedAt)}` : ''}</p>}
                        <DataList rows={d.board?.entries.slice(0, 20)} columns={boardCols} rowKey={e => e.candidateId}
                            empty={<Card><p className="text-sm text-ink-3">Aucun candidat approuvé.</p></Card>}
                            card={e => (
                                <span className="flex items-center gap-3">
                                    <span className="size-8 shrink-0 grid place-items-center rounded-pill bg-surface-2 font-bold tabular">{e.rank}</span>
                                    <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{e.displayName} <span className="font-normal text-ink-3">n°{e.number}</span></span>
                                        <span className="block text-xs text-ink-2">{formatNumber(e.freeVotes)} gratuits · {formatNumber(e.paidVotes)} payants{e.category ? ` · ${e.category}` : ''}</span></span>
                                    <span className="text-sm font-bold tabular">{formatNumber(e.totalVotes)}</span>
                                </span>
                            )} />
                    </section>

                    <section>
                        <SectionTitle action={<Link to="?onglet=a-verifier" className="text-sm font-semibold text-primary">File « À vérifier »</Link>}>Signalements ({d.flags.length})</SectionTitle>
                        {d.flags.length === 0 ? <Card><p className="text-sm text-ink-3">Aucun signalement.</p></Card> : (
                            <ul className="divide-y divide-border border border-border rounded-tile">
                                {d.flags.map(f => (
                                    <li key={f._id} className="px-3 py-2.5 space-y-1">
                                        <span className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-sm">{flagSubjectKind(f)}</span>
                                            <span className="flex gap-1.5"><Badge tone={f.score >= FREEZE_BLOCK_SCORE ? 'danger' : 'neutral'}>Score {f.score}</Badge><StatusBadge status={f.status} labels={FLAG_STATUS} /></span>
                                        </span>
                                        <span className="block text-xs text-ink-2">{f.signals.map(s => FRAUD_SIGNAL_LABELS[s.code]?.label ?? 'Autre signal').join(', ')} · {formatDateTime(f.createdAt)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section>
                        <SectionTitle>Exports du défi</SectionTitle>
                        <Card padded={false} className="px-4 py-1">
                            <ExportButtons kinds={['leaderboard', 'results', 'transactions', 'votes', 'candidates', 'audit']} scope={{ challengeId: c._id }} />
                        </Card>
                    </section>
                </div>
            )}

            {c && (
                <>
                    <ConfirmSheet open={action === 'suspend'} onClose={() => setAction(null)} tone="danger" title={`Suspendre « ${c.name} » ?`}
                        message={<p>Les inscriptions et les votes (gratuits et payants) seront refusés jusqu’à la reprise. Le motif est journalisé.</p>}
                        reason={{ label: 'Motif de la suspension', minLength: 3, suggestions: ['Fraude suspectée', 'Plaintes de participants', 'Contenu inapproprié'] }}
                        confirmLabel="Suspendre"
                        onConfirm={async (reason) => { await suspendAnimationChallenge(c._id, reason); done('Défi suspendu : inscriptions et votes refusés jusqu’à reprise.'); }} />
                    <ConfirmSheet open={action === 'resume'} onClose={() => setAction(null)} title={`Reprendre « ${c.name} » ?`}
                        message={<p>Les inscriptions et les votes reprennent selon le calendrier du défi.</p>}
                        confirmLabel="Reprendre"
                        onConfirm={async () => { await resumeAnimationChallenge(c._id); done('Défi repris.'); }} />
                    <ConfirmSheet open={action === 'cancel'} onClose={() => setAction(null)} tone="danger" title={`Annuler « ${c.name} » ?`}
                        message={<>
                            <p><b>Action irréversible.</b> Tous les votes payants ({formatNumber(c.counters.paidTransactions)} achat{c.counters.paidTransactions > 1 ? 's' : ''}, {formatMoney(c.counters.paidRevenue)}) sont remboursés en totalité sur le solde SBC des votants, qui sont prévenus.</p>
                            <p>Aucun résultat ne sera publié. Les candidats inscrits reçoivent le motif.</p>
                        </>}
                        reason={{ label: 'Motif de l’annulation (envoyé aux candidats)', minLength: 5, suggestions: ['Événement annulé', 'Fraude massive', 'Règlement non respecté'] }}
                        confirmLabel="Annuler le défi"
                        onConfirm={async (reason) => {
                            const res = await cancelAnimationChallenge(c._id, reason);
                            const n = res.refundedTransactions ?? 0;
                            done(`Défi annulé. ${n} achat${n > 1 ? 's' : ''} de votes remboursé${n > 1 ? 's' : ''}.`);
                        }} />
                    <ConfirmSheet open={action === 'freeze'} onClose={() => setAction(null)} tone="success" title="Figer le résultat ?"
                        message={<p>Le classement calculé devient définitif, les récompenses de rang sont attribuées et le défi passe en « Terminé ». L’organisateur pourra ensuite publier le résultat.</p>}
                        confirmLabel="Figer"
                        onConfirm={async () => {
                            setFreezeError(null);
                            try {
                                await freezeAnimationResult(c._id);
                            } catch (e) {
                                const code = apiErrorCode(e);
                                const message = (code && FREEZE_ERRORS[code]) || errorMessage(e, 'Action impossible.');
                                setFreezeError({ code, message });
                                throw new Error(message);
                            }
                            done('Résultat figé.');
                        }} />
                </>
            )}
        </Sheet>
    );
}
