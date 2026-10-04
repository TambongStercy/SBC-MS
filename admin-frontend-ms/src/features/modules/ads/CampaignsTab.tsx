import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getAdsCampaigns, type AdsCampaign } from '../../../api/adsNetwork';
import { DataList, EmptyState, Pagination, Select, StatusBadge, type Column } from '../../../ui';
import { formatDate, formatMoney, formatNumber, thumbnailUrl } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { CampaignSheet } from './CampaignSheet';
import { CAMPAIGN_STATUS, STATUS_FILTER } from './shared';

function Creative({ c }: { c: AdsCampaign }) {
    return c.mediaType === 'image' && c.mediaFileId
        ? <img src={thumbnailUrl(c.mediaFileId, 96)} alt="" className="size-11 rounded-tile object-cover bg-surface-2 shrink-0" />
        : <span className="size-11 rounded-tile bg-surface-2 grid place-items-center text-xs text-ink-3 shrink-0">{c.mediaType === 'video' ? 'Vidéo' : '—'}</span>;
}

/** Every campaign; "À valider" is the moderation queue (the home screen links there). */
export function CampaignsTab() {
    const [statusParam, setStatus] = useParamState('statut', '');
    const status = statusParam === 'pending_review' ? 'a-valider' : statusParam; // older links
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AdsCampaign | null>(null);
    const statuses = (STATUS_FILTER.find(f => f.value === status) ?? STATUS_FILTER[0]).statuses;
    const q = useQuery({ queryKey: ['ads', 'campaigns', status, page], queryFn: () => getAdsCampaigns({ status: statuses, page, limit: 20 }), placeholderData: keepPreviousData });

    const cols: Column<AdsCampaign>[] = [
        { key: 'c', header: 'Campagne', cell: c => (
            <span className="flex items-center gap-3 min-w-0"><Creative c={c} />
                <span className="min-w-0"><span className="block font-semibold truncate">{c.title}</span><span className="block text-xs text-ink-2 truncate">{c.advertiser?.name ?? 'Annonceur inconnu'}</span></span></span>
        ) },
        { key: 's', header: 'Statut', cell: c => <StatusBadge status={c.status} labels={CAMPAIGN_STATUS} /> },
        { key: 'p', header: 'Vues', align: 'right', cell: c => `${formatNumber(c.progress?.uniqueViewsDelivered ?? 0)} / ${formatNumber(c.targetUniqueViews)}` },
        { key: 'm', header: 'Payé', align: 'right', cell: c => formatMoney(c.amountPaid) },
        { key: 'd', header: 'Date', cell: c => <span className="text-ink-2 whitespace-nowrap">{formatDate(c.submittedForReviewAt || c.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="sm:w-64"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                {STATUS_FILTER.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select></div>
            <DataList rows={q.data?.campaigns} columns={cols} rowKey={c => c._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title={status === 'a-valider' ? 'Aucune campagne à valider' : 'Aucune campagne'} />}
                card={c => (
                    <span className="flex items-center gap-3"><Creative c={c} />
                        <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{c.title}</span>
                            <span className="block text-xs text-ink-2 truncate">{c.advertiser?.name ?? 'Annonceur inconnu'} · {formatMoney(c.amountPaid)}</span>
                            <span className="mt-1 block"><StatusBadge status={c.status} labels={CAMPAIGN_STATUS} /></span></span>
                    </span>
                )} />
            {q.data && <Pagination page={q.data.pagination.page} totalPages={q.data.pagination.pages} total={q.data.pagination.total} onChange={setPage} />}
            {open && <CampaignSheet campaign={open} onClose={() => setOpen(null)} />}
        </div>
    );
}
