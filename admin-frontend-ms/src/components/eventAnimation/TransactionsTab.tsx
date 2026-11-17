import { useState } from 'react';
import {
    FRAUD_REVIEWS, FRAUD_REVIEW_LABELS, FRAUD_SIGNAL_LABELS, VOTE_TX_STATUSES, VOTE_TX_STATUS_LABELS, fmtDate, listStuckRefunds,
    listVoteTransactions, num, refundVoteTransaction, retryRefund, xaf,
    type AnimVoteRefund, type AnimVoteTransaction, type FraudReview, type VoteTxStatus,
} from '../../api/animation';
import { FRAUD_REVIEW, REFUND_STATUS, TX_STATUS, errorMessage, operatorLabel, plural, useAnim, useAsync, useChallengeIndex } from './shared';
import { Badge, Button, Card, ExportButtons, KV, Modal, Pager, ReasonConfirm, Section, StatusBadge, Table, UserRef, selectCls, tdCls, trCls } from './ui';

const PAGE = 25;
const pct = (rate: number) => `${num(Math.round(rate * 10000) / 100)} %`;
const money = (n: number, currency?: string) => (currency && currency !== 'XAF' ? `${num(n)} ${currency}` : xaf(n));
const signals = (codes: string[]) => codes.map(c => FRAUD_SIGNAL_LABELS[c]?.label ?? 'Autre signal').join(', ');

function TxStatus({ tx }: { tx: AnimVoteTransaction }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            <StatusBadge status={tx.status} labels={TX_STATUS} />
            {tx.lateSettlement && <Badge tone="warning">Hors délai</Badge>}
            {tx.fraud && tx.fraud.review !== 'NONE' && <StatusBadge status={tx.fraud.review} labels={FRAUD_REVIEW} />}
            {tx.fraud && tx.fraud.flags?.length > 0 && <span className="basis-full text-xs text-gray-400">{signals(tx.fraud.flags)}</span>}
        </span>
    );
}

/** Paid votes: every purchase, the refunds still waiting for their money, exports. */
export default function TransactionsTab() {
    const { refresh, notifySuccess, param, setParams } = useAnim();
    const { challenges, challengeName } = useChallengeIndex();
    const challengeId = param('defi');
    const setChallengeId = (id: string) => setParams({ tab: 'votes', ...(id ? { defi: id } : {}) });
    const [status, setStatus] = useState<VoteTxStatus | ''>('');
    const [review, setReview] = useState<FraudReview | ''>('');
    const [page, setPage] = useState(1);
    const [exports, setExports] = useState(false);
    const [open, setOpen] = useState<AnimVoteTransaction | null>(null);
    const [refunding, setRefunding] = useState(false);

    const q = useAsync(
        () => listVoteTransactions({ status: status || undefined, review: review || undefined, challengeId: challengeId || undefined, page, limit: PAGE }),
        `${status}|${review}|${challengeId}|${page}`,
    );
    const items = q.data?.items ?? [];
    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);

    return (
        <div className="space-y-4">
            <StuckRefunds name={challengeName} />

            <div className="flex flex-wrap items-center gap-3">
                <select value={status} onChange={e => { setStatus(e.target.value as VoteTxStatus | ''); setPage(1); }} className={selectCls}>
                    <option value="">Tous les statuts</option>{VOTE_TX_STATUSES.map(s => <option key={s} value={s}>{VOTE_TX_STATUS_LABELS[s]}</option>)}
                </select>
                <select value={review} onChange={e => { setReview(e.target.value as FraudReview | ''); setPage(1); }} className={selectCls}>
                    <option value="">Toute vérification</option>{FRAUD_REVIEWS.map(r => <option key={r} value={r}>{r === 'NONE' ? 'Non signalées' : FRAUD_REVIEW_LABELS[r]}</option>)}
                </select>
                <select value={challengeId} onChange={e => { setChallengeId(e.target.value); setPage(1); }} className={`${selectCls} max-w-xs`}>
                    <option value="">Tous les défis</option>
                    {!knownChallenge && <option value={challengeId}>Défi sélectionné</option>}
                    {challenges.map(c => <option key={c._id} value={c._id}>{c.name}{c.event?.title ? ` — ${c.event.title}` : ''}</option>)}
                </select>
                <Button className="ml-auto" onClick={() => setExports(v => !v)}>{exports ? 'Masquer les exports' : 'Exporter…'}</Button>
            </div>
            {exports && (
                <Card className="space-y-1">
                    <p className="text-xs text-gray-400">
                        {challengeId ? `Transactions du défi « ${challengeName(challengeId)} ».` : 'Toutes les transactions (aucun défi choisi).'} Les filtres de statut et de vérification ne s’appliquent pas à l’export.
                    </p>
                    <ExportButtons kinds={['transactions']} scope={{ challengeId: challengeId || undefined }} />
                </Card>
            )}

            <Table headers={['Date', 'Défi', 'Montant', 'Votes', 'Commission SBC', 'Net organisateur', 'Statut']}
                loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload}
                empty={q.data && items.length === 0 ? 'Aucune transaction' : undefined}>
                {items.map(tx => (
                    <tr key={tx._id} className={trCls} onClick={() => setOpen(tx)}>
                        <td className={`${tdCls} text-xs text-gray-400 whitespace-nowrap`}>{fmtDate(tx.createdAt)}</td>
                        <td className={tdCls}><div className="font-medium">{tx.challengeName ?? 'Défi'}</div><div className="text-xs text-gray-400">{[tx.eventTitle, tx.packageSnapshot?.label].filter(Boolean).join(' · ')}</div></td>
                        <td className={`${tdCls} text-right font-semibold whitespace-nowrap`}>{money(tx.amount, tx.currency)}</td>
                        <td className={`${tdCls} text-right`}>{num(tx.votes)}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{money(tx.commissionAmount, tx.currency)}<div className="text-xs text-gray-400">{pct(tx.commissionRate)}</div></td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{money(tx.organizerNet, tx.currency)}</td>
                        <td className={tdCls}><TxStatus tx={tx} /></td>
                    </tr>
                ))}
            </Table>
            {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Modal onClose={() => setOpen(null)} title={`Achat de ${num(open.votes)} votes`} subtitle={open.challengeName}
                    footer={open.status === 'SUCCESS' ? <Button variant="danger" onClick={() => setRefunding(true)}>Rembourser {money(open.amount, open.currency)}…</Button> : undefined}>
                    <TxStatus tx={open} />
                    <Section title="Votant"><UserRef id={open.userId} fallback="Votant" /></Section>
                    <KV items={[
                        ['Défi', open.challengeName ?? 'Défi'],
                        open.eventTitle ? ['Événement', open.eventTitle] : null,
                        open.packageSnapshot ? ['Pack', `${open.packageSnapshot.label} (${num(open.packageSnapshot.votes)} votes)`] : null,
                        ['Montant payé', money(open.amount, open.currency)],
                        ['Commission SBC', `${money(open.commissionAmount, open.currency)} (${pct(open.commissionRate)})`],
                        ['Net organisateur', money(open.organizerNet, open.currency)],
                        ['Créé le', fmtDate(open.createdAt)],
                        open.settledAt ? ['Payé le', fmtDate(open.settledAt)] : null,
                        open.refundedAt ? ['Remboursé le', fmtDate(open.refundedAt)] : null,
                        open.paymentMethod ? ['Moyen de paiement', operatorLabel(open.paymentMethod)] : null,
                        open.paymentSessionId ? ['Référence paiement', <span key="ref" className="font-mono text-xs break-all">{open.paymentSessionId}</span>] : null,
                    ]} />
                    {open.lateSettlement && <p className="text-sm rounded-lg bg-amber-900/30 border border-amber-700 px-3 py-2">Payé après la clôture des votes : remboursé, aucun vote compté.</p>}
                    {open.fraud && open.fraud.flags?.length > 0 && (
                        <Section title="Signaux anti-fraude">
                            <ul className="space-y-1.5 text-sm">
                                {open.fraud.flags.map(f => (
                                    <li key={f}><b>{FRAUD_SIGNAL_LABELS[f]?.label ?? 'Autre signal'}</b>{FRAUD_SIGNAL_LABELS[f]?.help && <span className="block text-gray-400">{FRAUD_SIGNAL_LABELS[f].help}</span>}</li>
                                ))}
                            </ul>
                        </Section>
                    )}
                    {challengeId !== open.challengeId && (
                        <Button small onClick={() => { setChallengeId(open.challengeId); setPage(1); setOpen(null); }}>Voir seulement ce défi</Button>
                    )}
                    <ReasonConfirm open={refunding} title={`Rembourser ${money(open.amount, open.currency)} ?`}
                        message={<>
                            <p className="mb-2">{money(open.amount, open.currency)} sont crédités sur le solde SBC du votant, qui est prévenu, et ses {num(open.votes)} votes sont retirés du classement.</p>
                            <p>La part de l’organisateur ({money(open.organizerNet, open.currency)}) est reprise sur son solde.</p>
                        </>}
                        label="Motif du remboursement (envoyé au votant)" minLength={3} suggestions={['Demande du votant', 'Paiement en double', 'Fraude']}
                        confirmText="Rembourser" onCancel={() => setRefunding(false)}
                        onConfirm={async (reason) => {
                            await refundVoteTransaction(open._id, reason);
                            notifySuccess(`Remboursement de ${money(open.amount, open.currency)} lancé ; les ${num(open.votes)} votes sont retirés du classement.`);
                            setOpen(null); refresh();
                        }} />
                </Modal>
            )}
        </div>
    );
}

/** Refunds whose money side failed (buyer credit or organiser debit): the job retries every 30 s; SBC can force a try. */
function StuckRefunds({ name }: { name: (id?: string | null) => string }) {
    const { refresh, notifySuccess, notifyError } = useAnim();
    const [retrying, setRetrying] = useState<string | null>(null);
    const q = useAsync(() => listStuckRefunds(), 'stuck');
    const rows = q.data ?? [];
    if (!rows.length) return null;

    const retry = async (r: AnimVoteRefund) => {
        setRetrying(r.voteTransactionId);
        try {
            const after = await retryRefund(r.voteTransactionId);
            if (after?.status === 'COMPLETED') notifySuccess('Remboursement finalisé.');
            else notifyError(`Toujours en échec : ${after?.lastError ?? 'erreur inconnue'}`);
            refresh();
        } catch (e) {
            notifyError(errorMessage(e, 'Nouvel essai impossible.'));
        } finally { setRetrying(null); }
    };
    const progress = (r: AnimVoteRefund) => (r.walletCreditedAt ? 'Votant crédité' : 'Votant pas encore crédité') + (r.organizerDebitedAt ? ' · organisateur débité' : '');

    return (
        <section className="rounded-xl border border-amber-600 bg-amber-900/20 p-4 space-y-3">
            <div>
                <p className="text-sm font-semibold text-amber-100">{rows.length} {plural(rows.length, 'remboursement')} en attente d’argent</p>
                <p className="text-xs text-gray-300">Le crédit du votant ou le débit de l’organisateur n’a pas abouti. Ils sont retentés automatiquement ; « Réessayer » force un essai tout de suite.</p>
            </div>
            <Table headers={['Votant', 'Défi', 'Montant', 'État', 'Dernière erreur', '']}>
                {rows.map(r => (
                    <tr key={r._id} className="border-t border-gray-700">
                        <td className={tdCls}><UserRef id={r.userId} fallback="Votant" /></td>
                        <td className={`${tdCls} text-gray-300`}>{name(r.challengeId)}</td>
                        <td className={`${tdCls} text-right font-semibold whitespace-nowrap`}>{xaf(r.amount)}</td>
                        <td className={tdCls}><StatusBadge status={r.status} labels={REFUND_STATUS} /><div className="text-xs text-gray-400 mt-0.5">{r.attempts} {plural(r.attempts, 'essai')} · {progress(r)}</div></td>
                        <td className={`${tdCls} text-xs text-red-300 break-words max-w-xs`}>{r.lastError || '—'}</td>
                        <td className={tdCls}>
                            <Button small disabled={retrying !== null} onClick={() => retry(r)}>{retrying === r.voteTransactionId ? 'Essai…' : 'Réessayer'}</Button>
                        </td>
                    </tr>
                ))}
            </Table>
        </section>
    );
}
