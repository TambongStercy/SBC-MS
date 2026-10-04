import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getAccountTransactions, type AccountTransaction } from '../../services/adminAccountTransactionApi';
import { listAdminTransactions, type PaymentIntent } from '../../services/adminPaymentApi';
import { getUserWithdrawalHistory, type WithdrawalTransaction } from '../../services/adminWithdrawalApi';
import { DataList, EmptyState, Pagination, StatusBadge, type Column } from '../../ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { PAYMENT_STATUS, TX_STATUS, TX_TYPE, gatewayLabel, paymentTypeLabel, txTypeLabel } from '../../lib/labels';
import { WithdrawalSheet, type WithdrawalLike } from '../money/WithdrawalSheet';

const signed = (t: AccountTransaction) => {
    const sign = TX_TYPE[t.type]?.sign ?? 0;
    const txt = formatMoney(Math.abs(t.amount), t.currency);
    return <span className={sign > 0 ? 'text-success font-semibold' : sign < 0 ? 'font-semibold' : 'text-ink-2 font-semibold'}>{sign > 0 ? '+ ' : sign < 0 ? '− ' : ''}{txt}</span>;
};

/** Every movement on the member's balances (the ledger), newest first. */
export function MemberMovements({ memberId }: { memberId: string }) {
    const [page, setPage] = useState(1);
    const q = useQuery({
        queryKey: ['member', memberId, 'movements', page],
        queryFn: () => getAccountTransactions({ userSearchTerm: memberId, page, limit: 20 }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<AccountTransaction>[] = [
        { key: 'd', header: 'Date', cell: t => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(t.createdAt)}</span> },
        { key: 't', header: 'Mouvement', cell: t => <span><span className="font-semibold">{txTypeLabel(t.type)}</span>{t.description && <span className="block text-xs text-ink-3 truncate max-w-[22rem]">{t.description}</span>}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: signed },
        { key: 's', header: 'Statut', cell: t => <StatusBadge status={t.status} labels={TX_STATUS} /> },
    ];
    return (
        <>
            <DataList rows={q.data?.data} columns={cols} rowKey={t => t._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                empty={<EmptyState title="Aucun mouvement" />}
                card={t => (
                    <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold">{txTypeLabel(t.type)}</span><span className="block text-xs text-ink-3">{formatDateTime(t.createdAt)}</span></span>
                        <span className="text-right shrink-0">{signed(t)}<span className="block mt-0.5"><StatusBadge status={t.status} labels={TX_STATUS} /></span></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.currentPage} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
        </>
    );
}

/** The member's withdrawals, all statuses. A row opens the full detail. */
export function MemberWithdrawals({ memberId }: { memberId: string }) {
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const q = useQuery({
        queryKey: ['member', memberId, 'withdrawals', page],
        queryFn: () => getUserWithdrawalHistory(memberId, page, 20).then(r => r.data),
        placeholderData: keepPreviousData,
    });
    const cols: Column<WithdrawalTransaction>[] = [
        { key: 'd', header: 'Date', cell: w => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(w.createdAt)}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: w => <span className="font-semibold">{formatMoney(w.amount, w.currency)}</span> },
        { key: 'p', header: 'Fournisseur', cell: w => <span className="text-ink-2">{w.serviceProvider || w.metadata?.selectedPayoutService || '—'}</span> },
        { key: 's', header: 'Statut', cell: w => <StatusBadge status={w.status} labels={TX_STATUS} /> },
    ];
    return (
        <>
            <DataList rows={q.data?.withdrawals} columns={cols} rowKey={w => w.transactionId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={w => setOpen(w)} empty={<EmptyState title="Aucun retrait" />}
                card={w => (
                    <span className="flex items-center justify-between gap-3">
                        <span><span className="block font-semibold tabular">{formatMoney(w.amount, w.currency)}</span><span className="block text-xs text-ink-3">{formatDateTime(w.createdAt)}</span></span>
                        <StatusBadge status={w.status} labels={TX_STATUS} />
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.total} onChange={setPage} />}
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
        </>
    );
}

/** What the member paid (subscriptions, tickets, campaigns…), including failed attempts. */
export function MemberPayments({ memberId }: { memberId: string }) {
    const [page, setPage] = useState(1);
    const q = useQuery({
        queryKey: ['member', memberId, 'payments', page],
        queryFn: () => listAdminTransactions({ userSearchTerm: memberId, page, limit: 20 }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<PaymentIntent>[] = [
        { key: 'd', header: 'Date', cell: p => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(p.createdAt)}</span> },
        { key: 't', header: 'Pour', cell: p => <span className="font-semibold">{paymentTypeLabel(p.paymentType)}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: p => formatMoney(p.amount ?? p.paidAmount, p.currency ?? p.paidCurrency) },
        { key: 'g', header: 'Fournisseur', cell: p => <span className="text-ink-2">{gatewayLabel(p.gateway)}</span> },
        { key: 's', header: 'Statut', cell: p => <StatusBadge status={p.status} labels={PAYMENT_STATUS} /> },
    ];
    return (
        <>
            <DataList rows={q.data?.data} columns={cols} rowKey={p => p._id || p.sessionId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                empty={<EmptyState title="Aucun paiement" />}
                card={p => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold">{paymentTypeLabel(p.paymentType)}</span><span className="block text-xs text-ink-3">{formatDateTime(p.createdAt)} · {gatewayLabel(p.gateway)}</span></span>
                        <span className="text-right shrink-0"><span className="block font-semibold tabular">{formatMoney(p.amount ?? p.paidAmount, p.currency ?? p.paidCurrency)}</span><StatusBadge status={p.status} labels={PAYMENT_STATUS} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.currentPage} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
        </>
    );
}
