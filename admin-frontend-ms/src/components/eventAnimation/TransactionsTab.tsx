import { useEffect, useState } from 'react';
import {
    FRAUD_REVIEWS, FRAUD_REVIEW_LABELS, FRAUD_SIGNAL_LABELS, VOTE_TX_STATUSES, VOTE_TX_STATUS_LABELS, fmtDate, listStuckRefunds,
    listVoteTransactions, num, refundVoteTransaction, retryRefund,
    type AnimVoteRefund, type AnimVoteTransaction, type FraudReview, type VoteTxStatus,
} from '../../api/animation';
import { FRAUD_REVIEW, REFUND_STATUS, TX_STATUS, errorMessage, operatorLabel, plural, useAnim, useAsync, useChallengeIndex } from './shared';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import { EmptyState, Panel, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, FilterBar, FilterSelect, formatMoney } from '../moduleKit';
import { Badge, Button, ExportButtons, KV, Modal, Pager, ReasonConfirm, Section, StatusBadge, Table, UserRef, tdCls } from './ui';
import { Money03Icon } from '@hugeicons/core-free-icons';

const PAGE = 25;
const pct = (rate: number) => `${num(Math.round(rate * 10000) / 100)} %`;
const money = (n: number, currency?: string) => (currency && currency !== 'XAF' && currency !== 'USD' ? `${num(n)} ${currency}` : formatMoney(n, currency));
const signals = (codes: string[]) => codes.map(c => FRAUD_SIGNAL_LABELS[c]?.label ?? 'Autre signal').join(', ');

function TxStatus({ tx }: { tx: AnimVoteTransaction }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            <StatusBadge status={tx.status} labels={TX_STATUS} />
            {tx.lateSettlement && <Badge tone="warning">Hors délai</Badge>}
            {tx.fraud && tx.fraud.review !== 'NONE' && <StatusBadge status={tx.fraud.review} labels={FRAUD_REVIEW} />}
            {tx.fraud && tx.fraud.flags?.length > 0 && <span className="basis-full text-xs text-fg-muted">{signals(tx.fraud.flags)}</span>}
        </span>
    );
}

/** Paid votes: every purchase, the refunds still waiting for their money, exports. */
export default function TransactionsTab() {
    const { refresh, notifySuccess, param, setParams, apiParams, scopeKey } = useAnim();
    const canWrite = usePermission('events') === 'write';
    const { challenges, challengeName } = useChallengeIndex();
    const challengeId = param('defi');
    const setChallengeId = (id: string) => setParams({ tab: 'votes', ...(id ? { defi: id } : {}) });
    const [status, setStatus] = useState<VoteTxStatus | ''>('');
    const [review, setReview] = useState<FraudReview | ''>('');
    const [page, setPage] = useState(1);
    // a new country/period starts again at page 1
    useEffect(() => { setPage(1); }, [scopeKey]);
    const [exports, setExports] = useState(false);
    const [open, setOpen] = useState<AnimVoteTransaction | null>(null);
    const [refunding, setRefunding] = useState(false);

    const q = useAsync(
        () => listVoteTransactions({ status: status || undefined, review: review || undefined, challengeId: challengeId || undefined, page, limit: PAGE, ...apiParams }),
        `${status}|${review}|${challengeId}|${page}|${scopeKey}`,
    );
    const items = q.data?.items ?? [];
    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);

    const columns: ListColumn<AnimVoteTransaction>[] = [
        {
            key: 'challenge', header: 'Défi', cell: tx => (
                <div className="min-w-0"><p className="truncate font-medium text-fg">{tx.challengeName ?? 'Défi'}</p>
                    <p className="truncate text-xs text-fg-muted">{[tx.eventTitle, tx.packageSnapshot?.label].filter(Boolean).join(' · ')}</p></div>
            ),
        },
        { key: 'amount', header: 'Montant', numeric: true, cell: tx => <span className="font-medium">{money(tx.amount, tx.currency)}</span> },
        { key: 'votes', header: 'Votes', numeric: true, cell: tx => num(tx.votes) },
        {
            key: 'commission', header: 'Commission SBC', numeric: true,
            cell: tx => <span>{money(tx.commissionAmount, tx.currency)}<span className="block text-xs text-fg-muted">{pct(tx.commissionRate)} · net org. {money(tx.organizerNet, tx.currency)}</span></span>,
        },
        { key: 'status', header: 'Statut', cell: tx => <TxStatus tx={tx} /> },
        { key: 'date', header: 'Date', cell: tx => <DateText value={tx.createdAt} className="text-fg-muted" /> },
    ];

    return (
        <div className="space-y-4">
            <StuckRefunds name={challengeName} />

            <Panel>
                <div className="space-y-3 border-b border-line p-4">
                    <FilterBar
                        filterCount={3}
                        activeCount={(status ? 1 : 0) + (review ? 1 : 0) + (challengeId ? 1 : 0)}
                        onClear={() => { setStatus(''); setReview(''); setChallengeId(''); setPage(1); }}
                        filters={(
                            <>
                                <FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => { setStatus(v as VoteTxStatus | ''); setPage(1); }}
                                    options={VOTE_TX_STATUSES.map(x => ({ value: x, label: VOTE_TX_STATUS_LABELS[x] }))} />
                                <FilterSelect label="Vérification" allLabel="Toute vérification" value={review} onChange={v => { setReview(v as FraudReview | ''); setPage(1); }}
                                    options={FRAUD_REVIEWS.map(r => ({ value: r, label: r === 'NONE' ? 'Non signalées' : FRAUD_REVIEW_LABELS[r] }))} />
                                <FilterSelect label="Défi" allLabel="Tous les défis" value={challengeId} onChange={v => { setChallengeId(v); setPage(1); }}
                                    options={[
                                        ...(!knownChallenge ? [{ value: challengeId, label: 'Défi sélectionné' }] : []),
                                        ...challenges.map(c => ({ value: c._id, label: `${c.name}${c.event?.title ? ` — ${c.event.title}` : ''}` })),
                                    ]} />
                            </>
                        )}
                        trailing={<Button onClick={() => setExports(v => !v)}>{exports ? 'Masquer les exports' : 'Exporter…'}</Button>}
                    />
                    {exports && (
                        <div className="rounded-panel border border-line p-4">
                            <p className="mb-1 text-xs text-fg-muted">
                                {challengeId ? `Transactions du défi « ${challengeName(challengeId)} ».` : 'Toutes les transactions (aucun défi choisi).'} Les filtres de statut et de vérification ne s’appliquent pas à l’export.
                            </p>
                            <ExportButtons kinds={['transactions']} scope={{ challengeId: challengeId || undefined }} />
                        </div>
                    )}
                </div>
                <div className={q.loading && q.data ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={items}
                        columns={columns}
                        rowKey={tx => tx._id}
                        onRowClick={setOpen}
                        loading={q.loading && !q.data}
                        empty={q.error && !q.data ? <ErrorState error={new Error(q.error)} onRetry={q.reload} /> : (
                            <EmptyState icon={Money03Icon} title="Aucune transaction" description="Les achats de packs de votes apparaîtront ici." />
                        )}
                    />
                </div>
                {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} pageSize={PAGE} onChange={setPage} />}
            </Panel>

            {open && (
                <Modal onClose={() => setOpen(null)} title={`Achat de ${num(open.votes)} votes`} subtitle={open.challengeName}
                    footer={open.status === 'SUCCESS' && canWrite ? <Button variant="danger" onClick={() => setRefunding(true)}>Rembourser {money(open.amount, open.currency)}…</Button> : undefined}>
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
                    {open.lateSettlement && <p className="rounded-panel border border-warning/40 bg-warning-soft/60 px-3 py-2 text-sm text-fg">Payé après la clôture des votes : remboursé, aucun vote compté.</p>}
                    {open.fraud && open.fraud.flags?.length > 0 && (
                        <Section title="Signaux anti-fraude">
                            <ul className="space-y-1.5 text-sm">
                                {open.fraud.flags.map(f => (
                                    <li key={f}><span className="font-medium text-fg">{FRAUD_SIGNAL_LABELS[f]?.label ?? 'Autre signal'}</span>{FRAUD_SIGNAL_LABELS[f]?.help && <span className="block text-fg-muted">{FRAUD_SIGNAL_LABELS[f].help}</span>}</li>
                                ))}
                            </ul>
                        </Section>
                    )}
                    {challengeId !== open.challengeId && (
                        <Button small onClick={() => { setChallengeId(open.challengeId); setPage(1); setOpen(null); }}>Voir seulement ce défi</Button>
                    )}
                    <ReasonConfirm open={refunding && canWrite} title={`Rembourser ${money(open.amount, open.currency)} ?`}
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
        <section className="space-y-3 rounded-panel border border-warning/40 bg-warning-soft/40 p-4">
            <div>
                <p className="text-sm font-semibold text-fg">{rows.length} {plural(rows.length, 'remboursement')} en attente d’argent</p>
                <p className="text-xs text-fg-muted">Le crédit du votant ou le débit de l’organisateur n’a pas abouti. Ils sont retentés automatiquement ; « Réessayer » force un essai tout de suite.</p>
            </div>
            <Table headers={['Votant', 'Défi', 'Montant', 'État', 'Dernière erreur', '']}>
                {rows.map(r => (
                    <tr key={r._id} className="border-t border-line">
                        <td className={tdCls}><UserRef id={r.userId} fallback="Votant" /></td>
                        <td className={`${tdCls} text-fg-muted`}>{name(r.challengeId)}</td>
                        <td className={`${tdCls} text-right font-semibold whitespace-nowrap tabular-nums`}>{formatMoney(r.amount)}</td>
                        <td className={tdCls}><StatusBadge status={r.status} labels={REFUND_STATUS} /><div className="text-xs text-fg-muted mt-0.5">{r.attempts} {plural(r.attempts, 'essai')} · {progress(r)}</div></td>
                        <td className={`${tdCls} max-w-xs break-words text-xs text-danger`}>{r.lastError || '—'}</td>
                        <td className={tdCls}>
                            <Can module="events" write>
                                <Button small disabled={retrying !== null && retrying !== r.voteTransactionId} loading={retrying === r.voteTransactionId} onClick={() => retry(r)}>Réessayer</Button>
                            </Can>
                        </td>
                    </tr>
                ))}
            </Table>
        </section>
    );
}
