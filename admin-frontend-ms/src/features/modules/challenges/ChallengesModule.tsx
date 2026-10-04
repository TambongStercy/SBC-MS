import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, DataList, EmptyState, Input, Page, Pagination, Select, Sheet, StatusBadge, Textarea, notify, type Column } from '../../../ui';
import { formatDate, formatMoney, formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { monthName } from '../tombola/api';
import { STATUS, createChallenge, listChallenges, type Challenge } from './api';

const PAGE = 20;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function NewChallenge({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const now = new Date();
    const [f, setF] = useState({
        campaignName: '', month: now.getMonth() + 1, year: now.getFullYear(),
        startDate: ymd(now), endDate: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)), fr: '', en: '',
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async () => {
        if (!f.campaignName.trim()) { setError('Donne un nom au challenge.'); return; }
        if (!f.fr.trim() || !f.en.trim()) { setError('La description est demandée en français et en anglais.'); return; }
        if (f.endDate <= f.startDate) { setError('La fin doit venir après le début.'); return; }
        setBusy(true); setError(null);
        try {
            const c = await createChallenge({ campaignName: f.campaignName.trim(), month: f.month, year: f.year, startDate: f.startDate, endDate: f.endDate, description: { fr: f.fr.trim(), en: f.en.trim() } });
            await qc.invalidateQueries({ queryKey: ['challenges'] });
            notify.success('Challenge créé en brouillon.');
            onClose();
            navigate(`/modules/impact-challenge/${c._id}`);
        } catch (e) { setError(errorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Sheet open={open} onClose={onClose} busy={busy} title="Nouveau challenge"
            footer={<div className="flex justify-end"><Button onClick={save} loading={busy}>Créer le brouillon</Button></div>}>
            <div className="space-y-3">
                <Input label="Nom" value={f.campaignName} onChange={e => setF({ ...f, campaignName: e.target.value })} placeholder="Impact Challenge d’octobre" />
                <div className="grid grid-cols-2 gap-3">
                    <Select label="Mois" value={f.month} onChange={e => setF({ ...f, month: Number(e.target.value) })}>
                        {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                    </Select>
                    <Select label="Année" value={f.year} onChange={e => setF({ ...f, year: Number(e.target.value) })}>
                        {[now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
                    </Select>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Input label="Début" type="date" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} />
                    <Input label="Fin" type="date" value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} />
                </div>
                <Textarea label="Description (français)" rows={3} value={f.fr} onChange={e => setF({ ...f, fr: e.target.value })} />
                <Textarea label="Description (anglais)" rows={3} value={f.en} onChange={e => setF({ ...f, en: e.target.value })} />
                <p className="text-xs text-ink-3">Il reste en brouillon le temps d’ajouter les entrepreneurs. La tombola du même mois est créée et liée s’il n’y en a pas encore.</p>
                {error && <p className="text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
            </div>
        </Sheet>
    );
}

/** Monthly Impact Challenges: entrepreneurs, votes, and the payout. */
export default function ChallengesModule() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const q = useQuery({ queryKey: ['challenges', 'list', page], queryFn: () => listChallenges(page, PAGE), placeholderData: keepPreviousData });
    const cols: Column<Challenge>[] = [
        { key: 'n', header: 'Challenge', cell: c => <span><span className="block font-semibold">{c.campaignName}</span><span className="block text-xs text-ink-2">{monthName(c.month)} {c.year}</span></span> },
        { key: 's', header: 'Statut', cell: c => <StatusBadge status={c.status} labels={STATUS} /> },
        { key: 'v', header: 'Votes', align: 'right', cell: c => formatNumber(c.totalVoteCount) },
        { key: 'm', header: 'Collecté', align: 'right', cell: c => <span className="font-semibold tabular">{formatMoney(c.totalCollected)}</span> },
        { key: 'd', header: 'Période', cell: c => <span className="text-ink-2 whitespace-nowrap">{formatDate(c.startDate)} → {formatDate(c.endDate)}</span> },
    ];
    return (
        <Page title="Impact Challenge" back="/modules" actions={<Button size="sm" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Nouveau</Button>}>
            <div className="space-y-3">
                <DataList rows={q.data?.challenges} columns={cols} rowKey={c => c._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                    onRowClick={c => navigate(`/modules/impact-challenge/${c._id}`)}
                    empty={<EmptyState title="Aucun challenge">Crée le premier avec « Nouveau ».</EmptyState>}
                    card={c => (
                        <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0"><span className="block font-semibold truncate">{c.campaignName}</span>
                                <span className="block text-xs text-ink-2">{monthName(c.month)} {c.year} · {formatMoney(c.totalCollected)}</span></span>
                            <StatusBadge status={c.status} labels={STATUS} />
                        </span>
                    )} />
                {q.data && q.data.total > PAGE && <Pagination page={page} totalPages={Math.ceil(q.data.total / PAGE)} total={q.data.total} onChange={setPage} />}
            </div>
            <NewChallenge open={creating} onClose={() => setCreating(false)} />
        </Page>
    );
}
