import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../../api/apiClient';
import { listAdminResaleListings, type AdminResaleListing, type ResaleListingStatus } from '../../../api/event';
import { Button, ConfirmSheet, DataList, EmptyState, KeyValue, Pagination, Select, Sheet, StatusBadge, notify, type Column } from '../../../ui';
import { formatDateTime, formatMoney } from '../../../lib/format';
import { MemberById } from '../../members/MemberById';
import { LISTING_STATUS, useEventIndex } from './shared';

const PAGE = 20;
// The old client sent no reason; the endpoints accept one and pass it to the seller's notice.
const suspend = (id: string, reason: string) => apiClient.post(`/tickets/admin/resale-listings/${id}/suspend`, { reason });
const remove = (id: string, reason: string) => apiClient.delete(`/tickets/admin/resale-listings/${id}`, { data: { reason } });

/** The resale marketplace: take a listing off the market (suspend) or refuse it for good (remove). */
export function ResaleTab() {
    const qc = useQueryClient();
    const { title } = useEventIndex();
    const [status, setStatus] = useState<'' | ResaleListingStatus>('ACTIVE');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AdminResaleListing | null>(null);
    const [action, setAction] = useState<'suspend' | 'remove' | null>(null);
    const q = useQuery({ queryKey: ['events', 'listings', status, page], queryFn: () => listAdminResaleListings({ status: status || undefined, limit: PAGE, skip: (page - 1) * PAGE }), placeholderData: keepPreviousData });
    const cols: Column<AdminResaleListing>[] = [
        { key: 'e', header: 'Événement', cell: l => <span className="font-semibold">{title(l.eventId)}</span> },
        { key: 'p', header: 'Prix d’origine', align: 'right', cell: l => formatMoney(l.originalPrice) },
        { key: 'a', header: 'Prix demandé', align: 'right', cell: l => <span className="font-semibold">{formatMoney(l.askingPrice)}</span> },
        { key: 's', header: 'Statut', cell: l => <StatusBadge status={l.status} labels={LISTING_STATUS} /> },
        { key: 'd', header: 'Mise en vente', cell: l => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(l.listedAt)}</span> },
    ];
    const done = (msg: string) => { notify.success(msg); setOpen(null); qc.invalidateQueries({ queryKey: ['events'] }); };
    return (
        <div className="space-y-3">
            <div className="sm:w-56"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as ResaleListingStatus | ''); setPage(1); }}>
                <option value="">Toutes</option>{Object.entries(LISTING_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </Select></div>
            <DataList rows={q.data?.items} columns={cols} rowKey={l => l._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucune annonce" />}
                card={l => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{title(l.eventId)}</span><span className="block text-xs text-ink-2">{formatMoney(l.askingPrice)} (au lieu de {formatMoney(l.originalPrice)})</span></span>
                        <StatusBadge status={l.status} labels={LISTING_STATUS} />
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(q.data.total / PAGE))} total={q.data.total} onChange={setPage} />}
            {open && (
                <Sheet open onClose={() => setOpen(null)} title="Annonce de revente"
                    footer={open.status === 'ACTIVE' || open.status === 'SUSPENDED' || open.status === 'DRAFT' ? (
                        <div className="grid grid-cols-2 gap-2">
                            {open.status === 'ACTIVE' ? <Button variant="secondary" onClick={() => setAction('suspend')}>Suspendre…</Button> : <span />}
                            <Button variant="danger-soft" onClick={() => setAction('remove')}>Refuser…</Button>
                        </div>
                    ) : undefined}>
                    <div className="space-y-4">
                        <StatusBadge status={open.status} labels={LISTING_STATUS} />
                        <div><p className="text-xs font-bold uppercase tracking-wider text-ink-3 mb-1">Vendeur</p><MemberById id={open.sellerUserId} fallback="Vendeur" /></div>
                        <KeyValue items={[
                            ['Événement', title(open.eventId)], ['Prix d’origine', formatMoney(open.originalPrice)], ['Prix demandé', formatMoney(open.askingPrice)],
                            ['Mise en vente', formatDateTime(open.listedAt)], open.soldAt ? ['Vendue', formatDateTime(open.soldAt)] : null, open.cancelledAt ? ['Retirée', formatDateTime(open.cancelledAt)] : null,
                        ]} />
                    </div>
                </Sheet>
            )}
            {open && (
                <>
                    <ConfirmSheet open={action === 'suspend'} onClose={() => setAction(null)} title="Suspendre cette annonce ?"
                        message={<p>Elle quitte le marché. Le vendeur garde son billet et reçoit le motif.</p>}
                        reason={{ label: 'Motif (envoyé au vendeur)', suggestions: ['Prix abusif', 'Billet signalé', 'Vérification en cours'], minLength: 3 }}
                        confirmLabel="Suspendre" onConfirm={async (r) => { await suspend(open._id, r); done('Annonce suspendue.'); }} />
                    <ConfirmSheet open={action === 'remove'} onClose={() => setAction(null)} tone="danger" title="Refuser cette annonce ?"
                        message={<p>Elle est retirée définitivement. Le vendeur garde son billet, qui reste valable, et reçoit le motif.</p>}
                        reason={{ label: 'Motif (envoyé au vendeur)', suggestions: ['Prix abusif', 'Billet invalide', 'Annonce frauduleuse'], minLength: 3 }}
                        confirmLabel="Refuser l’annonce" onConfirm={async (r) => { await remove(open._id, r); done('Annonce refusée.'); }} />
                </>
            )}
        </div>
    );
}
