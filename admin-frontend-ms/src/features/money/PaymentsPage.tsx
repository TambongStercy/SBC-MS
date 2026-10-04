import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAdminTransactions, type PaymentIntent } from '../../services/adminPaymentApi';
import { getAccountTransactions, type AccountTransaction } from '../../services/adminAccountTransactionApi';
import { DataList, EmptyState, Input, KeyValue, MemberLink, Page, Pagination, SearchInput, Select, Sheet, StatusBadge, Tabs, type Column } from '../../ui';
import { formatDateTime, formatMoney, formatPhone } from '../../lib/format';
import { PAYMENT_STATUS, TX_STATUS, TX_TYPE, gatewayLabel, paymentTypeLabel, txTypeLabel } from '../../lib/labels';
import { useDebounced, useParamState } from '../../lib/hooks';
import { WithdrawalSheet, type WithdrawalLike } from './WithdrawalSheet';

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:w-80">
            <Input type="date" aria-label="Du" value={from} onChange={e => onFrom(e.target.value)} />
            <Input type="date" aria-label="Au" value={to} onChange={e => onTo(e.target.value)} />
        </div>
    );
}

/** Payment attempts: what members paid for, through which provider, and how it ended. */
function AttemptsTab() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [open, setOpen] = useState<PaymentIntent | null>(null);
    const term = useDebounced(search);
    const q = useQuery({
        queryKey: ['payments', term, status, from, to, page],
        queryFn: () => listAdminTransactions({ userSearchTerm: term || undefined, status: status || undefined, startDate: from || undefined, endDate: to || undefined, page, limit: 20 }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<PaymentIntent>[] = [
        { key: 'm', header: 'Membre', cell: p => <MemberLink id={p.userId} name={p.userName} phone={p.userPhoneNumber || p.phoneNumber} /> },
        { key: 't', header: 'Pour', cell: p => <span className="font-semibold">{paymentTypeLabel(p.paymentType)}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: p => formatMoney(p.amount ?? p.paidAmount, p.currency ?? p.paidCurrency) },
        { key: 'g', header: 'Fournisseur', cell: p => <span className="text-ink-2">{gatewayLabel(p.gateway)}</span> },
        { key: 's', header: 'Statut', cell: p => <StatusBadge status={p.status} labels={PAYMENT_STATUS} /> },
        { key: 'd', header: 'Date', cell: p => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(p.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col lg:flex-row gap-2">
                <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Nom, téléphone, email ou ID du membre" />
                <div className="lg:w-56"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">Tous les statuts</option>
                    {['SUCCEEDED', 'FAILED', 'PENDING_PROVIDER', 'PENDING_USER_INPUT', 'PROCESSING', 'CANCELED'].map(s => <option key={s} value={s}>{PAYMENT_STATUS[s][0]}</option>)}
                </Select></div>
                <DateRange from={from} to={to} onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }} />
            </div>
            <DataList rows={q.data?.data} columns={cols} rowKey={p => p._id || p.sessionId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucun paiement" />}
                card={p => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{p.userName || 'Membre'}</span><span className="block text-xs text-ink-2">{paymentTypeLabel(p.paymentType)} · {gatewayLabel(p.gateway)}</span></span>
                        <span className="text-right shrink-0"><span className="block font-semibold tabular">{formatMoney(p.amount ?? p.paidAmount, p.currency ?? p.paidCurrency)}</span><StatusBadge status={p.status} labels={PAYMENT_STATUS} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.currentPage} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
            {open && (
                <Sheet open onClose={() => setOpen(null)} title="Paiement" size="lg">
                    <div className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <MemberLink id={open.userId} name={open.userName} phone={open.userPhoneNumber || open.phoneNumber} />
                            <StatusBadge status={open.status} labels={PAYMENT_STATUS} />
                        </div>
                        <KeyValue items={[
                            ['Pour', paymentTypeLabel(open.paymentType)],
                            ['Montant', formatMoney(open.amount ?? open.paidAmount, open.currency ?? open.paidCurrency)],
                            ['Fournisseur', gatewayLabel(open.gateway)],
                            open.phoneNumber ? ['Payé depuis', `${formatPhone(open.phoneNumber)}${open.operator ? ` · ${open.operator}` : ''}`] : null,
                            open.gatewayPaymentId ? ['Référence fournisseur', <span className="font-mono text-xs break-all">{open.gatewayPaymentId}</span>] : null,
                            ['Session', <span className="font-mono text-xs break-all">{open.sessionId}</span>],
                            ['Créé', formatDateTime(open.createdAt)],
                            ['Mis à jour', formatDateTime(open.updatedAt)],
                        ]} />
                        {(open.webhookHistory?.length ?? 0) > 0 && (
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1">Historique fournisseur</p>
                                <ul className="text-sm divide-y divide-border">
                                    {open.webhookHistory!.map((h, i) => <li key={i} className="flex justify-between py-1.5"><span className="text-ink-2">{formatDateTime(h.timestamp)}</span><StatusBadge status={h.status} labels={PAYMENT_STATUS} /></li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </Sheet>
            )}
        </div>
    );
}

/** Every movement on members' balances: gains, withdrawals, payments, refunds, fees. */
function MovementsTab() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [type, setType] = useState('');
    const [status, setStatus] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const term = useDebounced(search);
    const q = useQuery({
        queryKey: ['movements', term, type, status, from, to, page],
        queryFn: () => getAccountTransactions({
            userSearchTerm: term || undefined, type: (type || undefined) as AccountTransaction['type'] | undefined,
            status: (status || undefined) as AccountTransaction['status'] | undefined, startDate: from || undefined, endDate: to || undefined, page, limit: 20,
        }),
        placeholderData: keepPreviousData,
    });
    const amount = (t: AccountTransaction) => {
        const s = TX_TYPE[t.type]?.sign ?? 0;
        return <span className={s > 0 ? 'text-success font-semibold' : 'font-semibold'}>{s > 0 ? '+ ' : s < 0 ? '− ' : ''}{formatMoney(Math.abs(t.amount), t.currency)}</span>;
    };
    const cols: Column<AccountTransaction>[] = [
        { key: 'm', header: 'Membre', cell: t => <MemberLink id={t.userId} name={t.userName} phone={t.userPhoneNumber} /> },
        { key: 't', header: 'Mouvement', cell: t => <span><span className="font-semibold">{txTypeLabel(t.type)}</span>{t.description && <span className="block text-xs text-ink-3 truncate max-w-[18rem]">{t.description}</span>}</span> },
        { key: 'a', header: 'Montant', align: 'right', cell: amount },
        { key: 's', header: 'Statut', cell: t => <StatusBadge status={t.status} labels={TX_STATUS} /> },
        { key: 'd', header: 'Date', cell: t => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(t.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col lg:flex-row gap-2">
                <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Nom, téléphone, email ou ID du membre" />
                <div className="lg:w-56"><Select aria-label="Type" value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
                    <option value="">Tous les mouvements</option>{Object.entries(TX_TYPE).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
                </Select></div>
                <div className="lg:w-48"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">Tous les statuts</option>{['completed', 'pending', 'processing', 'failed', 'refunded'].map(s => <option key={s} value={s}>{TX_STATUS[s][0]}</option>)}
                </Select></div>
                <DateRange from={from} to={to} onFrom={v => { setFrom(v); setPage(1); }} onTo={v => { setTo(v); setPage(1); }} />
            </div>
            <DataList rows={q.data?.data} columns={cols} rowKey={t => t._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={t => { if (t.type === 'withdrawal') setOpen(t as unknown as WithdrawalLike); }} empty={<EmptyState title="Aucun mouvement" />}
                card={t => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{t.userName || 'Membre'}</span><span className="block text-xs text-ink-2">{txTypeLabel(t.type)} · {formatDateTime(t.createdAt)}</span></span>
                        <span className="text-right shrink-0"><span className="block tabular">{amount(t)}</span><StatusBadge status={t.status} labels={TX_STATUS} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.currentPage} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
        </div>
    );
}

export default function PaymentsPage() {
    const [view, setView] = useParamState('vue', 'paiements');
    return (
        <Page title="Paiements des membres" width="wide">
            <div className="space-y-4">
                <Tabs value={view} onChange={setView} items={[{ value: 'paiements', label: 'Paiements' }, { value: 'mouvements', label: 'Mouvements de solde' }]} />
                {view === 'mouvements' ? <MovementsTab /> : <AttemptsTab />}
            </div>
        </Page>
    );
}
