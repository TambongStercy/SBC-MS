import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { bulkApproveWithdrawals, getPendingWithdrawals, type WithdrawalTransaction } from '../../services/adminWithdrawalApi';
import { getAccountTransactions, type AccountTransaction } from '../../services/adminAccountTransactionApi';
import { getValidatedWithdrawals } from '../../services/adminWithdrawalApi';
import { useAuth } from '../../context/AuthContext';
import {
    Button, ButtonLink, ConfirmSheet, DataList, EmptyState, KeyValue, MemberLink, Page, Pagination, SearchInput, Select, StatusBadge, Tabs, notify, type Column,
} from '../../ui';
import { formatDateTime, formatMoney, formatPhone } from '../../lib/format';
import { TX_STATUS, operatorLabel } from '../../lib/labels';
import { useDebounced, useParamState } from '../../lib/hooks';
import { WithdrawalSheet, type WithdrawalLike } from './WithdrawalSheet';

const net = (w: { amount: number; fee?: number }) => w.amount - (w.fee ?? 0);
const dest = (w: { metadata?: Record<string, any> }) => w.metadata?.withdrawalType === 'crypto'
    ? `${w.metadata?.cryptoCurrency ?? 'Crypto'}`
    : w.metadata?.accountInfo ? `${formatPhone(w.metadata.accountInfo.fullMomoNumber)} · ${operatorLabel(w.metadata.accountInfo.momoOperator)}` : '—';

/** Withdrawals waiting for approval, as a list: check several and validate them together. */
function PendingTab() {
    const qc = useQueryClient();
    const [page, setPage] = useState(1);
    const [type, setType] = useState<'' | 'mobile_money' | 'crypto'>('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [confirm, setConfirm] = useState(false);
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const q = useQuery({
        queryKey: ['withdrawals', 'pending-list', page, type],
        queryFn: () => getPendingWithdrawals(page, 20, type || undefined).then(r => r.data),
        placeholderData: keepPreviousData,
    });
    const rows = q.data?.withdrawals;
    const chosen = useMemo(() => (rows ?? []).filter(w => selected.has(w.transactionId)), [rows, selected]);
    const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const allOnPage = !!rows?.length && rows.every(w => selected.has(w.transactionId));

    const box = (w: WithdrawalTransaction) => (
        <input type="checkbox" aria-label={`Choisir le retrait de ${w.userName ?? ''}`} className="size-5 accent-[rgb(var(--c-primary))]"
            checked={selected.has(w.transactionId)} onClick={e => e.stopPropagation()} onChange={() => toggle(w.transactionId)} />
    );
    const cols: Column<WithdrawalTransaction>[] = [
        { key: 'x', header: <input type="checkbox" aria-label="Tout choisir sur la page" className="size-5" checked={allOnPage}
            onChange={() => setSelected(s => { const n = new Set(s); (rows ?? []).forEach(w => (allOnPage ? n.delete(w.transactionId) : n.add(w.transactionId))); return n; })} />, cell: box },
        { key: 'm', header: 'Membre', cell: w => <MemberLink id={w.userId} name={w.userName} phone={w.userPhoneNumber} /> },
        { key: 'a', header: 'À envoyer', align: 'right', cell: w => <span className="font-semibold">{formatMoney(net(w), w.currency)}</span> },
        { key: 'v', header: 'Vers', cell: w => <span className="text-ink-2 whitespace-nowrap">{dest(w)}</span> },
        { key: 'd', header: 'Demandé', cell: w => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(w.createdAt)}</span> },
    ];

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-48"><Select value={type} onChange={e => { setType(e.target.value as typeof type); setPage(1); }} aria-label="Type de retrait">
                    <option value="">Tous les types</option><option value="mobile_money">Mobile money</option><option value="crypto">Crypto</option>
                </Select></div>
                <ButtonLink to="/a-traiter/retraits" variant="ghost" size="sm">Valider un par un<ArrowRight size={16} /></ButtonLink>
                <div className="flex-1" />
                {chosen.length > 0 && (
                    <Button variant="success" onClick={() => setConfirm(true)}>
                        Valider {chosen.length} · {formatMoney(chosen.reduce((s, w) => s + net(w), 0))}
                    </Button>
                )}
            </div>
            <DataList rows={rows} columns={cols} rowKey={w => w.transactionId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={w => setOpen(w)} empty={<EmptyState title="Aucun retrait à valider" />}
                card={w => (
                    <span className="flex items-center gap-3">
                        {box(w)}
                        <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{w.userName}</span><span className="block text-xs text-ink-2 truncate">{dest(w)}</span></span>
                        <span className="font-semibold tabular shrink-0">{formatMoney(net(w), w.currency)}</span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.total} onChange={setPage} />}
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="success"
                title={`Valider ${chosen.length} retrait${chosen.length > 1 ? 's' : ''} ?`}
                message={<>
                    <KeyValue items={[['Retraits', String(chosen.length)], ['Total envoyé', formatMoney(chosen.reduce((s, w) => s + net(w), 0))]]} />
                    <p>L’argent part dès la validation, pour chacun.</p>
                </>}
                confirmLabel="Valider et envoyer"
                onConfirm={async () => {
                    const r = await bulkApproveWithdrawals({ transactionIds: chosen.map(w => w.transactionId), adminNotes: 'Validation groupée' });
                    const { approved, failed, errors } = r.data;
                    if (failed) notify.error(`${approved} validé${approved > 1 ? 's' : ''}, ${failed} en échec : ${errors.slice(0, 2).join(' · ')}`);
                    else notify.success(`${approved} retrait${approved > 1 ? 's' : ''} validé${approved > 1 ? 's' : ''}.`);
                    setSelected(new Set());
                    qc.invalidateQueries({ queryKey: ['withdrawals'] });
                    qc.invalidateQueries({ queryKey: ['queue', 'withdrawals'] });
                }} />
        </div>
    );
}

const HISTORY_STATUS: Record<string, string> = { completed: 'Payés', failed: 'Échoués', rejected_by_admin: 'Refusés', processing: 'Chez le fournisseur' };

/** Every finished withdrawal, searched and counted on the server (not just the page on screen). */
function HistoryTab() {
    const { role } = useAuth();
    // The ledger is admin-only; withdrawal admins read the withdrawal endpoint (no search).
    const ledger = role === 'admin';
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState('completed');
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const term = useDebounced(search);
    const q = useQuery({
        queryKey: ['withdrawals', 'history', ledger, status, term, page],
        queryFn: () => ledger
            ? getAccountTransactions({ type: 'withdrawal' as AccountTransaction['type'], status: status as AccountTransaction['status'], userSearchTerm: term || undefined, page, limit: 20 })
            : getValidatedWithdrawals(page, 20, status === 'completed' || status === 'rejected_by_admin' ? status : undefined).then(r => ({
                data: r.data.withdrawals as unknown as AccountTransaction[],
                pagination: { currentPage: r.data.pagination.page, totalPages: r.data.pagination.totalPages, totalCount: r.data.pagination.total, limit: 20 },
            })),
        placeholderData: keepPreviousData,
    });
    const cols: Column<AccountTransaction>[] = [
        { key: 'm', header: 'Membre', cell: t => <MemberLink id={t.userId} name={t.userName} phone={t.userPhoneNumber} link={ledger} /> },
        { key: 'a', header: 'Montant', align: 'right', cell: t => <span className="font-semibold">{formatMoney(t.amount, t.currency)}</span> },
        { key: 'p', header: 'Fournisseur', cell: t => <span className="text-ink-2">{t.serviceProvider || t.metadata?.selectedPayoutService || '—'}</span> },
        { key: 's', header: 'Statut', cell: t => <StatusBadge status={t.status} labels={TX_STATUS} /> },
        { key: 'd', header: 'Date', cell: t => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(t.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
                {ledger && <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Nom, téléphone, email ou ID du membre" />}
                <div className="sm:w-56"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="Statut">
                    {Object.entries(HISTORY_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select></div>
            </div>
            <DataList rows={q.data?.data} columns={cols} rowKey={t => t._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={t => setOpen(t as unknown as WithdrawalLike)} empty={<EmptyState title="Aucun retrait" />}
                card={t => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{t.userName || 'Membre'}</span><span className="block text-xs text-ink-3">{formatDateTime(t.createdAt)}</span></span>
                        <span className="text-right shrink-0"><span className="block font-semibold tabular">{formatMoney(t.amount, t.currency)}</span><StatusBadge status={t.status} labels={TX_STATUS} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.currentPage} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
        </div>
    );
}

export default function WithdrawalsPage() {
    const [view, setView] = useParamState('vue', 'a-valider');
    return (
        <Page title="Retraits" back="/argent">
            <div className="space-y-4">
                <Tabs value={view} onChange={setView} items={[{ value: 'a-valider', label: 'À valider' }, { value: 'historique', label: 'Historique' }]} />
                {view === 'historique' ? <HistoryTab /> : <PendingTab />}
            </div>
        </Page>
    );
}
