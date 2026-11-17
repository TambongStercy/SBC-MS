import { useState } from 'react';
import {
    FRAUD_SIGNAL_LABELS, VOTING_MODE_LABELS, apiErrorCode, cancelAnimationChallenge, fmtDate, freezeAnimationResult, getAnimationChallenge, num,
    resumeAnimationChallenge, suspendAnimationChallenge, xaf, type AnimChallenge, type ChallengeStatus,
} from '../../api/animation';
import {
    CHALLENGE_STATUS, EVENT_STATUS_LABELS, FLAG_STATUS, FREEZE_BLOCK_SCORE, FREEZE_ERRORS, PERIOD_LABELS, RESULT_STATUS,
    SCOPE_LABELS, SCORING_LABELS, TIE_RULE_LABELS, errorMessage, flagSubjectKind, plural, useAnim, useAsync,
} from './shared';
import { Badge, Button, Card, ExportButtons, KV, Modal, ReasonConfirm, Section, SimpleConfirm, Stat, StatusBadge, Table, tdCls } from './ui';

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
        ['Participation', p ? `${word(SCOPE_LABELS, p.mode)}, max ${num(p.maxCandidates)}${p.requiresApproval ? ', validation requise' : ''}` : '—'],
        ['Compteurs affichés au public', v?.showVoteCounts ? 'Oui' : 'Non'],
        ['Inscriptions', `${fmtDate(s?.registrationOpensAt)} → ${fmtDate(s?.registrationClosesAt)}`],
        ['Votes', `${fmtDate(s?.votingOpensAt)} → ${fmtDate(s?.votingClosesAt)}`],
        ['Délai de règlement des paiements', s?.settlementGraceMin !== undefined ? `${s.settlementGraceMin} min` : '—'],
        ['Créé le', fmtDate(c.createdAt)],
    ];
}

/**
 * One challenge for SBC: configuration, counters, result (with its ranking and
 * winners), live board (real counts even when hidden from the public), fraud
 * flags, exports, and the suspend / resume / cancel / freeze actions.
 */
export default function ChallengeDetail({ id, onClose }: { id: string; onClose: () => void }) {
    const { refresh, notifySuccess, setParams } = useAnim();
    const [action, setAction] = useState<Action | null>(null);
    const [freezeError, setFreezeError] = useState<{ code?: string; message: string } | null>(null);
    const q = useAsync(() => getAnimationChallenge(id), id);
    const d = q.data;
    const c = d?.challenge;
    const openFlags = d?.flags.filter(f => f.status === 'OPEN') ?? [];
    const done = (msg: string) => { notifySuccess(msg); refresh(); };
    const go = (params: Record<string, string>) => { onClose(); setParams(params); };

    const footer = c && !isFinal(c.status) ? (
        <>
            {c.status === 'RESULTS_PENDING' && <Button variant="success" onClick={() => setAction('freeze')}>Figer le résultat…</Button>}
            {c.suspendedAt
                ? <Button variant="primary" onClick={() => setAction('resume')}>Reprendre…</Button>
                : <Button variant="warning" onClick={() => setAction('suspend')}>Suspendre…</Button>}
            <Button variant="danger" onClick={() => setAction('cancel')}>Annuler le défi…</Button>
        </>
    ) : undefined;

    return (
        <Modal onClose={onClose} footer={footer}
            title={c?.name ?? 'Défi'}
            subtitle={d?.event ? `${d.event.title}${d.event.status ? ` · ${EVENT_STATUS_LABELS[d.event.status] ?? ''}` : ''}` : undefined}>
            {q.loading && !d ? <p className="text-gray-400">Chargement…</p> : !d || !c ? (
                <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-xl p-4">
                    Défi introuvable ou impossible à charger. <button onClick={q.reload} className="underline ml-2">Réessayer</button>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={c.status} labels={CHALLENGE_STATUS} />
                        {c.suspendedAt && <Badge tone="danger">Suspendu le {fmtDate(c.suspendedAt)}</Badge>}
                        {openFlags.length > 0 && <Badge tone="warning">{openFlags.length} {plural(openFlags.length, 'signalement ouvert', 'signalements ouverts')}</Badge>}
                        <button onClick={q.reload} className="ml-auto text-xs text-gray-300 hover:text-white border border-gray-600 rounded px-2 py-1">{q.loading ? 'Chargement…' : 'Recharger'}</button>
                    </div>
                    {c.suspendedAt && c.suspendedReason && (
                        <p className="text-sm rounded-lg bg-red-900/30 border border-red-800 text-red-100 px-3 py-2"><b>Motif de suspension :</b> {c.suspendedReason}</p>
                    )}
                    {c.cancellation && (
                        <p className="text-sm rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
                            Annulé le {fmtDate(c.cancellation.at)} — {c.cancellation.reason} ({num(c.cancellation.refundedTransactions)} {plural(c.cancellation.refundedTransactions, 'achat remboursé', 'achats remboursés')})
                        </p>
                    )}
                    {freezeError && (
                        <p className="text-sm rounded-lg bg-amber-900/30 border border-amber-700 text-amber-100 px-3 py-2" role="alert">
                            {freezeError.message}
                            {freezeError.code === 'FRAUD_REVIEW_PENDING' && <> <button onClick={() => go({ tab: 'a-verifier' })} className="font-semibold text-blue-300 underline">Ouvrir « À vérifier »</button></>}
                        </p>
                    )}

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Stat label="Candidats" value={`${num(c.counters.approved)} / ${num(c.counters.candidates)}`} hint="approuvés / total" />
                        <Stat label="Votes gratuits" value={num(c.counters.freeVotes)} />
                        <Stat label="Votes payants" value={num(c.counters.paidVotes)} hint={`${num(c.counters.paidTransactions)} ${plural(c.counters.paidTransactions, 'achat')}`} />
                        <Stat label="Revenus" value={xaf(c.counters.paidRevenue)} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                        <button onClick={() => go({ tab: 'votes', defi: c._id })} className="text-blue-300 hover:underline">Voir ses votes payants</button>
                        <button onClick={() => go({ tab: 'journal', defi: c._id })} className="text-blue-300 hover:underline">Voir son journal</button>
                    </div>

                    <Section title="Configuration"><KV items={config(c)} /></Section>

                    <Section title="Résultat">
                        <Card>
                            {!d.result ? <p className="text-sm text-gray-400">Pas encore calculé (le résultat est calculé à la clôture des votes).</p> : (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        <StatusBadge status={d.result.status} labels={RESULT_STATUS} />
                                        {d.result.publishedAt && <Badge tone="success">Publié</Badge>}
                                    </div>
                                    <KV items={[
                                        ['Calculé le', fmtDate(d.result.computedAt)],
                                        d.result.frozenAt ? ['Figé le', fmtDate(d.result.frozenAt)] : null,
                                        d.result.publishedAt ? ['Publié le', fmtDate(d.result.publishedAt)] : null,
                                    ]} />
                                    {d.result.ties?.length > 0 && (
                                        <p className="text-sm text-amber-300">{plural(d.result.ties.length, 'Égalité', 'Égalités')} : {d.result.ties.map(t => `rang ${t.rank} (${t.candidateIds.length} candidats)`).join(', ')}</p>
                                    )}
                                    {d.result.entries?.length > 0 && (
                                        <Table headers={['Rang', 'Candidat', 'Votes', 'Score']}>
                                            {d.result.entries.slice(0, 10).map(e => (
                                                <tr key={e.candidateId} className="border-t border-gray-700">
                                                    <td className={`${tdCls} font-bold`}>{e.rank}{e.sharedRank ? ' (ex æquo)' : ''}</td>
                                                    <td className={tdCls}>{e.displayName} <span className="text-gray-400">n°{e.number}</span></td>
                                                    <td className={`${tdCls} text-right`}>{num(e.totalVotes)}</td>
                                                    <td className={`${tdCls} text-right`}>{num(Math.round(e.score * 100) / 100)}</td>
                                                </tr>
                                            ))}
                                        </Table>
                                    )}
                                    <p className="text-xs text-gray-500 break-all">Empreinte de contrôle : {d.result.inputsHash}</p>
                                </div>
                            )}
                        </Card>
                    </Section>

                    <Section title="Classement en direct (top 20)">
                        {d.board && <p className="text-xs text-gray-400">{num(d.board.totals.candidates)} candidats classés · {num(d.board.totals.votes)} votes comptés{d.board.computedAt ? ` · ${fmtDate(d.board.computedAt)}` : ''}</p>}
                        <Table headers={['Rang', 'Candidat', 'Catégorie', 'Gratuits', 'Payants', 'Total', 'Score']}
                            empty={!d.board?.entries.length ? 'Aucun candidat approuvé.' : undefined}>
                            {d.board?.entries.slice(0, 20).map(e => (
                                <tr key={e.candidateId} className="border-t border-gray-700">
                                    <td className={`${tdCls} font-bold`}>{e.rank}</td>
                                    <td className={tdCls}><span className="font-medium">{e.displayName}</span> <span className="text-gray-400">n°{e.number}</span></td>
                                    <td className={tdCls}>{e.category || '—'}</td>
                                    <td className={`${tdCls} text-right`}>{num(e.freeVotes)}</td>
                                    <td className={`${tdCls} text-right`}>{num(e.paidVotes)}</td>
                                    <td className={`${tdCls} text-right font-semibold`}>{num(e.totalVotes)}</td>
                                    <td className={`${tdCls} text-right`}>{typeof e.score === 'number' ? num(Math.round(e.score * 100) / 100) : '—'}</td>
                                </tr>
                            ))}
                        </Table>
                    </Section>

                    <Section title={`Signalements (${d.flags.length})`} action={<button onClick={() => go({ tab: 'a-verifier' })} className="text-sm font-semibold text-blue-300">File « À vérifier »</button>}>
                        {d.flags.length === 0 ? <Card><p className="text-sm text-gray-400">Aucun signalement.</p></Card> : (
                            <ul className="divide-y divide-gray-700 border border-gray-700 rounded-lg">
                                {d.flags.map(f => (
                                    <li key={f._id} className="px-3 py-2.5 space-y-1">
                                        <span className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-sm">{flagSubjectKind(f)}{f.subjectLabel ? ` · ${f.subjectLabel}` : ''}</span>
                                            <span className="flex gap-1.5"><Badge tone={f.score >= FREEZE_BLOCK_SCORE ? 'danger' : 'neutral'}>Score {f.score}</Badge><StatusBadge status={f.status} labels={FLAG_STATUS} /></span>
                                        </span>
                                        <span className="block text-xs text-gray-400">{f.signals.map(s => FRAUD_SIGNAL_LABELS[s.code]?.label ?? 'Autre signal').join(', ')} · {fmtDate(f.createdAt)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section title="Exports du défi">
                        <Card>
                            <ExportButtons kinds={['leaderboard', 'results', 'winners', 'transactions', 'votes', 'candidates', 'audit']} scope={{ challengeId: c._id }} />
                        </Card>
                    </Section>

                    <ReasonConfirm open={action === 'suspend'} title={`Suspendre « ${c.name} » ?`}
                        message="Les inscriptions et les votes (gratuits et payants) seront refusés jusqu’à la reprise. Le motif est journalisé."
                        label="Motif de la suspension" minLength={3} suggestions={['Fraude suspectée', 'Plaintes de participants', 'Contenu inapproprié']}
                        confirmText="Suspendre" onCancel={() => setAction(null)}
                        onConfirm={async (reason) => { await suspendAnimationChallenge(c._id, reason); done('Défi suspendu : inscriptions et votes refusés jusqu’à reprise.'); }} />
                    <SimpleConfirm open={action === 'resume'} title={`Reprendre « ${c.name} » ?`}
                        message="Les inscriptions et les votes reprennent selon le calendrier du défi." confirmText="Reprendre"
                        onCancel={() => setAction(null)}
                        onConfirm={async () => { await resumeAnimationChallenge(c._id); done('Défi repris.'); }} />
                    <ReasonConfirm open={action === 'cancel'} title={`Annuler « ${c.name} » ?`}
                        message={<>
                            <p className="mb-2"><b>Action irréversible.</b> Tous les votes payants ({num(c.counters.paidTransactions)} {plural(c.counters.paidTransactions, 'achat')}, {xaf(c.counters.paidRevenue)}) sont remboursés en totalité sur le solde SBC des votants, qui sont prévenus.</p>
                            <p>Aucun résultat ne sera publié. Les candidats inscrits reçoivent le motif.</p>
                        </>}
                        label="Motif de l’annulation (envoyé aux candidats)" minLength={5} suggestions={['Événement annulé', 'Fraude massive', 'Règlement non respecté']}
                        confirmText="Annuler le défi" onCancel={() => setAction(null)}
                        onConfirm={async (reason) => {
                            const res = await cancelAnimationChallenge(c._id, reason);
                            const n = res.refundedTransactions ?? 0;
                            done(`Défi annulé. ${n} ${plural(n, 'achat')} de votes ${plural(n, 'remboursé')}.`);
                        }} />
                    <SimpleConfirm open={action === 'freeze'} title="Figer le résultat ?" variant="success"
                        message="Le classement calculé devient définitif, les récompenses de rang sont attribuées et le défi passe en « Terminé ». L’organisateur pourra ensuite publier le résultat."
                        confirmText="Figer" onCancel={() => setAction(null)}
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
        </Modal>
    );
}
