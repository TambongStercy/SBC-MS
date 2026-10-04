import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
    FRAUD_REVIEWS, FRAUD_REVIEW_LABELS, FRAUD_SIGNAL_LABELS, VOTE_TX_STATUSES, VOTE_TX_STATUS_LABELS,
    listStuckRefunds, listVoteTransactions, refundVoteTransaction, retryRefund,
    type AnimVoteRefund, type AnimVoteTransaction, type FraudReview, type VoteTxStatus,
} from '../../../api/animation';
import {
    Badge, Button, Card, ConfirmSheet, DataList, EmptyState, KeyValue, Pagination, SectionTitle, Select, Sheet, StatusBadge, notify, type Column,
} from '../../../ui';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { errorMessage, useParamState } from '../../../lib/hooks';
import { operatorLabel } from '../../../lib/labels';
import { MemberById } from '../../members/MemberById';
import { ExportButtons } from './Exports';
import { FRAUD_REVIEW, REFUND_STATUS, TX_STATUS, useAnimRefresh, useChallengeIndex } from './shared';

const PAGE = 25;
const pct = (rate: number) => `${formatNumber(Math.round(rate * 10000) / 100)} %`;
const signals = (codes: string[]) => codes.map(c => FRAUD_SIGNAL_LABELS[c]?.label ?? 'Autre signal').join(', ');

function TxStatus({ tx }: { tx: AnimVoteTransaction }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            <StatusBadge status={tx.status} labels={TX_STATUS} />
            {tx.lateSettlement && <Badge tone="warning">Hors délai</Badge>}
            {tx.fraud && tx.fraud.review !== 'NONE' && <StatusBadge status={tx.fraud.review} labels={FRAUD_REVIEW} />}
            {tx.fraud && tx.fraud.flags?.length > 0 && <span className="basis-full text-xs text-ink-3">{signals(tx.fraud.flags)}</span>}
        </span>
    );
}

/** Paid votes: every purchase, the refunds still waiting for their money, exports. */
export function TransactionsTab() {
    const refresh = useAnimRefresh();
    const { challenges, challengeName } = useChallengeIndex();
    const [status, setStatus] = useState<VoteTxStatus | ''>('');
    const [review, setReview] = useState<FraudReview | ''>('');
    const [challengeId, setChallengeId] = useParamState('defi', '');
    const [page, setPage] = useState(1);
    const [exports, setExports] = useState(false);
    const [open, setOpen] = useState<AnimVoteTransaction | null>(null);
    const [refunding, setRefunding] = useState(false);

    const q = useQuery({
        queryKey: ['animation', 'transactions', status, review, challengeId, page],
        queryFn: () => listVoteTransactions({ status: status || undefined, review: review || undefined, challengeId: challengeId || undefined, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });

    const cols: Column<AnimVoteTransaction>[] = [
        { key: 'd', header: 'Date', cell: tx => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(tx.createdAt)}</span> },
        { key: 'c', header: 'Défi', cell: tx => <span><span className="block font-semibold">{tx.challengeName ?? 'Défi'}</span><span className="block text-xs text-ink-2">{[tx.eventTitle, tx.packageSnapshot?.label].filter(Boolean).join(' · ')}</span></span> },
        { key: 'a', header: 'Montant', align: 'right', cell: tx => <span className="whitespace-nowrap font-semibold">{formatMoney(tx.amount, tx.currency)}</span> },
        { key: 'v', header: 'Votes', align: 'right', cell: tx => formatNumber(tx.votes) },
        { key: 'm', header: 'Commission SBC', align: 'right', cell: tx => <span className="whitespace-nowrap">{formatMoney(tx.commissionAmount, tx.currency)}<span className="block text-xs text-ink-3">{pct(tx.commissionRate)}</span></span> },
        { key: 'o', header: 'Net organisateur', align: 'right', cell: tx => <span className="whitespace-nowrap">{formatMoney(tx.organizerNet, tx.currency)}</span> },
        { key: 's', header: 'Statut', cell: tx => <TxStatus tx={tx} /> },
    ];

    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);

    return (
        <div className="space-y-3">
            <StuckRefunds name={challengeName} />

            <div className="grid grid-cols-2 lg:flex gap-2">
                <div className="lg:w-44"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as VoteTxStatus | ''); setPage(1); }}>
                    <option value="">Tous les statuts</option>{VOTE_TX_STATUSES.map(s => <option key={s} value={s}>{VOTE_TX_STATUS_LABELS[s]}</option>)}
                </Select></div>
                <div className="lg:w-48"><Select aria-label="Vérification" value={review} onChange={e => { setReview(e.target.value as FraudReview | ''); setPage(1); }}>
                    <option value="">Toute vérification</option>{FRAUD_REVIEWS.map(r => <option key={r} value={r}>{r === 'NONE' ? 'Non signalées' : FRAUD_REVIEW_LABELS[r]}</option>)}
                </Select></div>
                <div className="col-span-2 lg:w-72"><Select aria-label="Défi" value={challengeId} onChange={e => { setChallengeId(e.target.value); setPage(1); }}>
                    <option value="">Tous les défis</option>
                    {!knownChallenge && <option value={challengeId}>Défi sélectionné</option>}
                    {challenges.map(c => <option key={c._id} value={c._id}>{c.name}{c.event?.title ? ` — ${c.event.title}` : ''}</option>)}
                </Select></div>
                <Button variant="secondary" className="col-span-2 lg:ml-auto" onClick={() => setExports(v => !v)}>{exports ? 'Masquer les exports' : 'Exporter…'}</Button>
            </div>
            {exports && (
                <Card className="space-y-1">
                    <p className="text-xs text-ink-3">
                        {challengeId ? `Transactions du défi « ${challengeName(challengeId)} ».` : 'Toutes les transactions (aucun défi choisi).'} Les filtres de statut et de vérification ne s’appliquent pas à l’export.
                    </p>
                    <ExportButtons kinds={['transactions']} scope={{ challengeId: challengeId || undefined }} />
                </Card>
            )}

            <DataList rows={q.data?.items} columns={cols} rowKey={tx => tx._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<Card><EmptyState title="Aucune transaction" /></Card>}
                card={tx => (
                    <span className="block space-y-1">
                        <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0"><span className="block font-semibold truncate">{tx.challengeName ?? 'Défi'}</span><span className="block text-xs text-ink-2 truncate">{formatNumber(tx.votes)} votes · {formatDateTime(tx.createdAt)}</span></span>
                            <span className="text-sm font-bold tabular whitespace-nowrap">{formatMoney(tx.amount, tx.currency)}</span>
                        </span>
                        <TxStatus tx={tx} />
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Sheet open onClose={() => setOpen(null)} size="lg" title={`Achat de ${formatNumber(open.votes)} votes`}
                    footer={open.status === 'SUCCESS' ? <Button variant="danger-soft" full onClick={() => setRefunding(true)}>Rembourser {formatMoney(open.amount, open.currency)}…</Button> : undefined}>
                    <div className="space-y-4">
                        <TxStatus tx={open} />
                        <div><SectionTitle>Votant</SectionTitle><MemberById id={open.userId} fallback="Votant" /></div>
                        <KeyValue items={[
                            ['Défi', open.challengeName ?? 'Défi'],
                            open.eventTitle ? ['Événement', open.eventTitle] : null,
                            open.packageSnapshot ? ['Pack', `${open.packageSnapshot.label} (${formatNumber(open.packageSnapshot.votes)} votes)`] : null,
                            ['Montant payé', formatMoney(open.amount, open.currency)],
                            ['Commission SBC', `${formatMoney(open.commissionAmount, open.currency)} (${pct(open.commissionRate)})`],
                            ['Net organisateur', formatMoney(open.organizerNet, open.currency)],
                            ['Créé le', formatDateTime(open.createdAt)],
                            open.settledAt ? ['Payé le', formatDateTime(open.settledAt)] : null,
                            open.refundedAt ? ['Remboursé le', formatDateTime(open.refundedAt)] : null,
                            open.paymentMethod ? ['Moyen de paiement', operatorLabel(open.paymentMethod)] : null,
                            open.paymentSessionId ? ['Référence paiement', <span key="ref" className="font-mono text-xs break-all">{open.paymentSessionId}</span>] : null,
                        ]} />
                        {open.lateSettlement && <p className="text-sm rounded-tile bg-warning-soft px-3 py-2">Payé après la clôture des votes : remboursé, aucun vote compté.</p>}
                        {open.fraud && open.fraud.flags?.length > 0 && (
                            <section>
                                <SectionTitle>Signaux anti-fraude</SectionTitle>
                                <ul className="space-y-1.5 text-sm">
                                    {open.fraud.flags.map(f => (
                                        <li key={f}><b>{FRAUD_SIGNAL_LABELS[f]?.label ?? 'Autre signal'}</b>{FRAUD_SIGNAL_LABELS[f]?.help && <span className="block text-ink-2">{FRAUD_SIGNAL_LABELS[f].help}</span>}</li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {challengeId !== open.challengeId && (
                            <Button variant="ghost" size="sm" onClick={() => { setChallengeId(open.challengeId); setPage(1); setOpen(null); }}>Voir seulement ce défi</Button>
                        )}
                    </div>
                    <ConfirmSheet open={refunding} onClose={() => setRefunding(false)} tone="danger" title={`Rembourser ${formatMoney(open.amount, open.currency)} ?`}
                        message={<>
                            <p>{formatMoney(open.amount, open.currency)} sont crédités sur le solde SBC du votant, qui est prévenu, et ses {formatNumber(open.votes)} votes sont retirés du classement.</p>
                            <p>La part de l’organisateur ({formatMoney(open.organizerNet, open.currency)}) est reprise sur son solde.</p>
                        </>}
                        reason={{ label: 'Motif du remboursement (envoyé au votant)', minLength: 3, suggestions: ['Demande du votant', 'Paiement en double', 'Fraude'] }}
                        confirmLabel="Rembourser"
                        onConfirm={async (reason) => {
                            await refundVoteTransaction(open._id, reason);
                            notify.success(`Remboursement de ${formatMoney(open.amount, open.currency)} lancé ; les ${formatNumber(open.votes)} votes sont retirés du classement.`);
                            setOpen(null); refresh();
                        }} />
                </Sheet>
            )}
        </div>
    );
}

/** Refunds whose money side failed (buyer credit or organiser debit): the job retries every 30 s; SBC can force a try. */
function StuckRefunds({ name }: { name: (id?: string | null) => string }) {
    const refresh = useAnimRefresh();
    const [retrying, setRetrying] = useState<string | null>(null);
    const q = useQuery({ queryKey: ['animation', 'stuck-refunds'], queryFn: listStuckRefunds });
    const rows = q.data ?? [];
    if (!rows.length) return null;

    const retry = async (r: AnimVoteRefund) => {
        setRetrying(r.voteTransactionId);
        try {
            const after = await retryRefund(r.voteTransactionId);
            if (after?.status === 'COMPLETED') notify.success('Remboursement finalisé.');
            else notify.error(`Toujours en échec : ${after?.lastError ?? 'erreur inconnue'}`);
            refresh();
        } catch (e) {
            notify.error(errorMessage(e, 'Nouvel essai impossible.'));
        } finally { setRetrying(null); }
    };
    const action = (r: AnimVoteRefund) => (
        <Button size="sm" variant="secondary" loading={retrying === r.voteTransactionId} disabled={retrying !== null && retrying !== r.voteTransactionId}
            onClick={(e) => { e.stopPropagation(); retry(r); }}>Réessayer</Button>
    );
    const progress = (r: AnimVoteRefund) => (r.walletCreditedAt ? 'Votant crédité' : 'Votant pas encore crédité') + (r.organizerDebitedAt ? ' · organisateur débité' : '');
    const cols: Column<AnimVoteRefund>[] = [
        { key: 'v', header: 'Votant', cell: r => <MemberById id={r.userId} fallback="Votant" /> },
        { key: 'c', header: 'Défi', cell: r => <span className="text-ink-2">{name(r.challengeId)}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: r => <span className="font-semibold whitespace-nowrap">{formatMoney(r.amount)}</span> },
        { key: 's', header: 'État', cell: r => <span><StatusBadge status={r.status} labels={REFUND_STATUS} /><span className="block text-xs text-ink-3 mt-0.5">{r.attempts} essai{r.attempts > 1 ? 's' : ''} · {progress(r)}</span></span> },
        { key: 'e', header: 'Dernière erreur', cell: r => <span className="text-xs text-danger break-words">{r.lastError || '—'}</span> },
        { key: 'x', header: '', cell: action },
    ];
    return (
        <section className="rounded-card border border-warning bg-warning-soft p-3 sm:p-4 space-y-2">
            <p className="text-sm font-semibold text-ink">{rows.length} remboursement{rows.length > 1 ? 's' : ''} en attente d’argent</p>
            <p className="text-xs text-ink-2">Le crédit du votant ou le débit de l’organisateur n’a pas abouti. Ils sont retentés automatiquement ; « Réessayer » force un essai tout de suite.</p>
            <DataList rows={rows} columns={cols} rowKey={r => r._id}
                card={r => (
                    <span className="block space-y-2">
                        <span className="flex items-start justify-between gap-3"><MemberById id={r.userId} fallback="Votant" /><span className="font-bold tabular whitespace-nowrap">{formatMoney(r.amount)}</span></span>
                        <span className="block text-xs text-ink-2">{name(r.challengeId)} · {r.attempts} essai{r.attempts > 1 ? 's' : ''} · {progress(r)}</span>
                        {r.lastError && <span className="block text-xs text-danger break-words">{r.lastError}</span>}
                        <span className="flex items-center justify-between gap-2"><StatusBadge status={r.status} labels={REFUND_STATUS} />{action(r)}</span>
                    </span>
                )} />
        </section>
    );
}
