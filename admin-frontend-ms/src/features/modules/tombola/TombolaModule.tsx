import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataList, EmptyState, Page, Pagination, Select, Sheet, StatusBadge, notify, type Column } from '../../../ui';
import { formatDate, formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { STATUS, createTombola, listTombolas, monthName, periodLabel, type TombolaMonth } from './api';

const PAGE = 20;

function NewTombola({ open, onClose, hasOpen }: { open: boolean; onClose: () => void; hasOpen: boolean }) {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The service refuses future months.
    const future = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);
    const create = async () => {
        setBusy(true); setError(null);
        try {
            const t = await createTombola(month, year);
            await qc.invalidateQueries({ queryKey: ['tombola'] });
            notify.success(`Tombola de ${monthName(month)} ${year} ouverte.`);
            onClose();
            navigate(`/modules/tombola/tirage/${t._id}`);
        } catch (e) { setError(errorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Sheet open={open} onClose={onClose} busy={busy} title="Nouvelle tombola"
            footer={<div className="flex justify-end"><Button onClick={create} loading={busy} disabled={future}>Ouvrir la tombola</Button></div>}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <Select label="Mois" value={month} onChange={e => setMonth(Number(e.target.value))}>
                        {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                    </Select>
                    <Select label="Année" value={year} onChange={e => setYear(Number(e.target.value))}>
                        {[now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
                    </Select>
                </div>
                <p className="text-sm text-ink-2">
                    Elle s’ouvre tout de suite : les membres peuvent acheter leurs billets.{hasOpen ? ' La tombola actuellement ouverte se ferme.' : ''}
                </p>
                {future && <p className="text-sm text-danger">Pas de tombola pour un mois à venir.</p>}
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

/** Monthly tombolas: open one, follow ticket sales, draw the winners. */
export default function TombolaModule() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const q = useQuery({ queryKey: ['tombola', 'list', page], queryFn: () => listTombolas(page, PAGE), placeholderData: keepPreviousData });
    const hasOpen = !!q.data?.data.some(t => t.status === 'open');
    const cols: Column<TombolaMonth>[] = [
        { key: 'p', header: 'Mois', cell: t => <span className="font-semibold">{periodLabel(t)}</span> },
        { key: 's', header: 'Statut', cell: t => <StatusBadge status={t.status} labels={STATUS} /> },
        { key: 'b', header: 'Billets', align: 'right', cell: t => formatNumber(t.lastTicketNumber) },
        { key: 'w', header: 'Gagnants', align: 'right', cell: t => (t.winners.length ? formatNumber(t.winners.length) : '—') },
        { key: 'd', header: 'Tirage', cell: t => <span className="text-ink-2">{t.drawDate ? formatDate(t.drawDate) : '—'}</span> },
    ];
    return (
        <Page title="Tombola" actions={<Button size="sm" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Nouvelle</Button>}>
            <div className="space-y-3">
                <DataList rows={q.data?.data} columns={cols} rowKey={t => t._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                    onRowClick={t => navigate(`/modules/tombola/tirage/${t._id}`)}
                    empty={<EmptyState title="Aucune tombola">Ouvre la première avec « Nouvelle ».</EmptyState>}
                    card={t => (
                        <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0"><span className="block font-semibold">{periodLabel(t)}</span>
                                <span className="block text-xs text-ink-2">{formatNumber(t.lastTicketNumber)} billets{t.winners.length ? ` · ${t.winners.length} gagnants` : ''}</span></span>
                            <StatusBadge status={t.status} labels={STATUS} />
                        </span>
                    )} />
                {q.data && q.data.pagination.totalCount > PAGE && <Pagination page={page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
            </div>
            <NewTombola open={creating} onClose={() => setCreating(false)} hasOpen={hasOpen} />
        </Page>
    );
}
