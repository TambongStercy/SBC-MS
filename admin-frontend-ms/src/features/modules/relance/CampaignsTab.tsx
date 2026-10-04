import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MemberPicker } from '../../members/MemberPicker';
import type { Member } from '../../members/api';
import { DataList, EmptyState, Pagination, Select, StatusBadge, type Column } from '../../../ui';
import { formatDate, formatNumber } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { CAMPAIGN_STATUS, listCampaigns, type Campaign, type CampaignStatus } from './api';
import { CampaignSheet } from './CampaignSheet';

const PAGE = 20;

/** Every parrain's relance campaigns; open one to see its filleuls, pause it or stop it. */
export function CampaignsTab() {
    const [status, setStatus] = useParamState('statut', '');
    const [owner, setOwner] = useState<Member | null>(null);
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ['relance', 'campaigns', status, owner?._id, page],
        queryFn: () => listCampaigns({ status, userId: owner?._id, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    // The sheet reads the row from the list, so it follows a pause/resume once the list refetches.
    const open = q.data?.campaigns.find(c => c._id === openId) ?? null;

    const cols: Column<Campaign>[] = [
        { key: 'n', header: 'Campagne', cell: c => <span className="min-w-0"><span className="block font-semibold truncate">{c.name}</span><span className="block text-xs text-ink-2 truncate">{c.owner?.name ?? 'Parrain inconnu'}</span></span> },
        { key: 's', header: 'Statut', cell: c => <StatusBadge status={c.status} labels={CAMPAIGN_STATUS} /> },
        { key: 'f', header: 'Filleuls', align: 'right', cell: c => formatNumber(c.targetsEnrolled) },
        { key: 'm', header: 'Messages', align: 'right', cell: c => formatNumber(c.messagesSent) },
        { key: 'p', header: 'Ont payé', align: 'right', cell: c => formatNumber(c.targetsConverted ?? 0) },
        { key: 'd', header: 'Créée', cell: c => <span className="text-ink-2 whitespace-nowrap">{formatDate(c.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="grid sm:grid-cols-[16rem_1fr] gap-2">
                <Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">Toutes</option>
                    {(Object.keys(CAMPAIGN_STATUS) as CampaignStatus[]).map(s => <option key={s} value={s}>{CAMPAIGN_STATUS[s][0]}</option>)}
                </Select>
                <MemberPicker value={owner} onChange={m => { setOwner(m); setPage(1); }} />
            </div>
            <DataList rows={q.data?.campaigns} columns={cols} rowKey={c => c._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={c => setOpenId(c._id)} empty={<EmptyState title="Aucune campagne">{status || owner ? 'Rien ne correspond à ces filtres.' : null}</EmptyState>}
                card={c => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{c.name}</span>
                            <span className="block text-xs text-ink-2 truncate">{c.owner?.name ?? 'Parrain inconnu'} · {formatNumber(c.targetsEnrolled)} filleuls</span></span>
                        <StatusBadge status={c.status} labels={CAMPAIGN_STATUS} />
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}
            {open && <CampaignSheet campaign={open} onClose={() => setOpenId(null)} />}
        </div>
    );
}
