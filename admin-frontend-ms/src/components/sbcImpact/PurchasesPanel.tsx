import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Invoice01Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, EmptyState, Metric, Pagination, Panel, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../ui';
import {
    ConfirmDialog, DateText, ErrorState, FilterBar, FilterSelect, Money, formatMoney, formatNumber, plural, type ConfirmOptions,
} from '../moduleKit';
import {
    PAY_METHOD_LABELS, PURCHASE_STATUS_LABELS, flagLabel, impactErrorMessage, listPurchases, refundPurchase,
    type PayMethod, type PurchaseRow, type PurchaseStatus,
} from '../../services/impactV2Api';
import { candidateName, type CandidateIndex } from './candidateIndex';
import { PurchaseStatusBadge } from './shared';

const PAGE_SIZE = 25;

/** Where the refund stands: none, in progress, done, or uncertain (the job retries). */
function RefundCell({ p }: { p: PurchaseRow }) {
    if (p.refundUncertain) return <Badge tone="danger" title="Le remboursement n’a pas pu être confirmé : le système réessaie chaque minute.">Remboursement incertain</Badge>;
    if (!p.refund) return <span className="text-fg-subtle">—</span>;
    return (
        <span className="inline-flex flex-col items-end gap-0.5 md:items-start">
            <Badge tone={p.refund.at ? 'info' : 'warning'}>{p.refund.at ? 'Remboursé' : 'Remboursement en cours'}</Badge>
            <span className="line-clamp-2 text-xs text-fg-muted" title={p.refund.reason}>« {p.refund.reason} »</span>
        </span>
    );
}

/** The paid vote purchases: totals, filters, and « Rembourser » (admin code). */
export default function PurchasesPanel({ editionId, index, canRefund, onChanged, initialSignal = '' }: {
    editionId: string;
    /** For the candidate filter's choices. */
    index?: CandidateIndex;
    /** Start filtered: 'flagged' or 'uncertain' (the to-do link). */
    initialSignal?: '' | 'flagged' | 'uncertain';
    /** Write access and the TOP 3 not decided yet (the podium is frozen after). */
    canRefund: boolean;
    onChanged: () => void;
}) {
    const [status, setStatus] = useState<PurchaseStatus | ''>('');
    const [method, setMethod] = useState<PayMethod | ''>('');
    const [candidateId, setCandidateId] = useState('');
    /** '' | 'flagged' | 'uncertain' */
    const [signal, setSignal] = useState<'' | 'flagged' | 'uncertain'>(initialSignal);
    const [page, setPage] = useState(1);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    const list = useQuery({
        queryKey: ['sbc-impact', 'purchases', editionId, { status, method, candidateId, signal, page }],
        queryFn: () => listPurchases(editionId, {
            status, method, candidateId, flagged: signal === 'flagged', refundUncertain: signal === 'uncertain', page, limit: PAGE_SIZE,
        }),
        placeholderData: prev => prev,
    });
    const rows = list.data?.items ?? [];
    const total = list.data?.total ?? 0;
    const totals = list.data?.totals;
    const filter = (fn: () => void) => { fn(); setPage(1); };
    const active = [status, method, candidateId, signal].filter(Boolean).length;
    const who = (p: PurchaseRow) => p.candidateName ?? candidateName(index, p.candidateId);

    const askRefund = (p: PurchaseRow) => setConfirm({
        title: `Rembourser ${formatMoney(p.amount)} à ${p.buyerName ?? 'l’acheteur'} ?`,
        confirmLabel: 'Rembourser',
        description: `Les ${formatNumber(p.votes)} ${plural(p.votes, 'vote')} pour ${who(p)} sont retirés et l’argent revient sur le solde SBC de l’acheteur. Votre code d’authentification vous sera demandé.`,
        reason: { label: 'Raison (lue par l’acheteur)', required: true, minLength: 10 },
        onConfirm: async (reason: string) => {
            try {
                const done = await refundPurchase(p._id, reason);
                if (done.refundCompleted) toast.success('Achat remboursé : les votes sont retirés.');
                else toast.warning('Votes retirés. Le remboursement n’est pas encore confirmé : le système réessaie chaque minute.');
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le remboursement a échoué.'));
            } finally {
                void list.refetch();
                onChanged();
            }
        },
    });

    const statusCell = (p: PurchaseRow) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1 md:justify-start">
            <PurchaseStatusBadge status={p.status} />
            {p.lateSettlement && p.status !== 'REFUNDED' && <Badge tone="neutral">Non compté</Badge>}
        </span>
    );
    const flagsCell = (p: PurchaseRow) => (p.flags.length
        ? <span className="inline-flex flex-wrap gap-1">{p.flags.map(f => <Badge key={f} tone="danger">{flagLabel(f)}</Badge>)}</span>
        : <span className="text-fg-subtle">—</span>);
    const refundButton = (p: PurchaseRow) => (canRefund && p.status === 'SUCCESS' && !p.refund
        ? <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={e => { e.stopPropagation(); askRefund(p); }}>Rembourser</Button>
        : null);

    const columns: ListColumn<PurchaseRow>[] = [
        { key: 'buyer', header: 'Acheteur', cell: p => <span className="font-medium text-fg">{p.buyerName ?? `…${p.userId.slice(-6)}`}</span> },
        { key: 'candidate', header: 'Candidat', cell: who },
        { key: 'votes', header: 'Votes', numeric: true, cell: p => formatNumber(p.votes) },
        { key: 'amount', header: 'Montant', numeric: true, cell: p => <Money value={p.amount} /> },
        { key: 'method', header: 'Moyen', cell: p => PAY_METHOD_LABELS[p.method] ?? p.method },
        { key: 'status', header: 'Statut', cell: statusCell },
        { key: 'flags', header: 'Signalements', cell: flagsCell },
        { key: 'refund', header: 'Remboursement', cell: p => <RefundCell p={p} /> },
        { key: 'at', header: 'Date', cell: p => <DateText value={p.createdAt} /> },
        { key: 'action', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: p => refundButton(p) ?? <span /> },
    ];

    const statuses = Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[];
    const metricValue = (v: ReactNode) => (list.isLoading ? <Skeleton className="h-7 w-24" /> : v);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric label="Recettes (achats payés)" value={metricValue(<Money value={totals?.revenue ?? 0} />)} hint="L’argent des votes revient à SBC." />
                <Metric label="Votes payants comptés" value={metricValue(formatNumber(totals?.countedVotes ?? 0))} />
                <Metric
                    label="Achats"
                    value={metricValue(formatNumber(statuses.reduce((n, s) => n + (totals?.byStatus[s]?.count ?? 0), 0)))}
                    hint={totals ? (
                        <span className="flex flex-wrap gap-1">
                            {statuses.filter(s => totals.byStatus[s]?.count).map(s => (
                                <Badge key={s} tone="outline">{PURCHASE_STATUS_LABELS[s]} : {formatNumber(totals.byStatus[s]!.count)}</Badge>
                            ))}
                        </span>
                    ) : undefined}
                />
            </div>

            <Panel>
                <PanelHeader title="Achats de votes" description={list.data ? `${formatNumber(total)} ${plural(total, 'achat')}${active ? ' avec ces filtres' : ''}` : undefined} />
                <div className="px-4 pb-3 sm:px-5">
                    <FilterBar
                        filterCount={4}
                        activeCount={active}
                        onClear={() => filter(() => { setStatus(''); setMethod(''); setCandidateId(''); setSignal(''); })}
                        filters={(
                            <>
                                <FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => filter(() => setStatus(v as PurchaseStatus | ''))}
                                    options={statuses.map(s => ({ value: s, label: PURCHASE_STATUS_LABELS[s] }))} />
                                <FilterSelect label="Moyen" allLabel="Tous les moyens" value={method} onChange={v => filter(() => setMethod(v as PayMethod | ''))}
                                    options={(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map(m => ({ value: m, label: PAY_METHOD_LABELS[m] }))} />
                                <FilterSelect label="Candidat" allLabel="Tous les candidats" value={candidateId} onChange={v => filter(() => setCandidateId(v))}
                                    options={[...(index?.values() ?? [])].map(c => ({ value: c._id, label: candidateName(index, c._id) }))} />
                                <FilterSelect label="Signalements" allLabel="Tous les achats" value={signal} onChange={v => filter(() => setSignal(v as '' | 'flagged' | 'uncertain'))}
                                    options={[
                                        { value: 'flagged', label: 'Signalés' },
                                        { value: 'uncertain', label: `Remboursements incertains${totals?.uncertainRefunds ? ` (${formatNumber(totals.uncertainRefunds)})` : ''}` },
                                    ]} />
                            </>
                        )}
                    />
                </div>
                <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={rows}
                        columns={columns}
                        rowKey={p => p._id}
                        loading={list.isLoading}
                        className="border-t border-line"
                        empty={list.isError ? (
                            <ErrorState error={new Error(impactErrorMessage(list.error, 'Impossible de charger les achats.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                        ) : (
                            <EmptyState icon={Invoice01Icon} title={active ? 'Aucun achat avec ces filtres' : 'Aucun achat de votes pour l’instant'} />
                        )}
                    />
                </div>
                <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </Panel>

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
