import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveOrganizer, listOrganizers, suspendOrganizer, type AdminOrganizer, type OrganizerStatus } from '../../../api/event';
import { Button, ConfirmSheet, DataList, EmptyState, KeyValue, MemberLink, Pagination, Select, Sheet, StatusBadge, notify, type Column } from '../../../ui';
import { formatDate, formatMoney, formatNumber, formatPhone } from '../../../lib/format';
import { ORGANIZER_STATUS } from './shared';

const PAGE = 20;

/** Organisers: approve newcomers, suspend when needed. Opens on "En attente" when some wait. */
export function OrganizersTab() {
    const qc = useQueryClient();
    const pending = useQuery({ queryKey: ['events', 'organizers', 'PENDING', 'count'], queryFn: () => listOrganizers({ status: 'PENDING', limit: 1 }) });
    const [status, setStatus] = useState<'' | OrganizerStatus | null>(null);
    useEffect(() => { if (status === null && pending.data) setStatus(pending.data.total ? 'PENDING' : ''); }, [pending.data, status]);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AdminOrganizer | null>(null);
    const [action, setAction] = useState<'approve' | 'suspend' | null>(null);
    const q = useQuery({
        queryKey: ['events', 'organizers', status, page], enabled: status !== null,
        queryFn: () => listOrganizers({ status: status || undefined, limit: PAGE, skip: (page - 1) * PAGE }), placeholderData: keepPreviousData,
    });
    const refresh = () => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['queue', 'organizers'] }); };
    const cols: Column<AdminOrganizer>[] = [
        { key: 'n', header: 'Organisateur', cell: o => <span><span className="block font-semibold">{o.displayName}</span><span className="block text-xs text-ink-2">{o.contactEmail || formatPhone(o.contactPhone)}</span></span> },
        { key: 's', header: 'Statut', cell: o => <StatusBadge status={o.status} labels={ORGANIZER_STATUS} /> },
        { key: 'e', header: 'Événements', align: 'right', cell: o => formatNumber(o.stats?.eventsPublished ?? 0) },
        { key: 'v', header: 'Billets vendus', align: 'right', cell: o => formatNumber(o.stats?.ticketsSold ?? 0) },
        { key: 'd', header: 'Inscrit', cell: o => <span className="text-ink-2">{formatDate(o.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="sm:w-56"><Select aria-label="Statut" value={status ?? ''} onChange={e => { setStatus(e.target.value as OrganizerStatus | ''); setPage(1); }}>
                <option value="">Tous</option><option value="PENDING">En attente</option><option value="APPROVED">Approuvés</option><option value="SUSPENDED">Suspendus</option>
            </Select></div>
            <DataList rows={q.data?.items} columns={cols} rowKey={o => o._id} loading={q.isLoading || status === null} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title={status === 'PENDING' ? 'Aucun organisateur en attente' : 'Aucun organisateur'} />}
                card={o => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{o.displayName}</span><span className="block text-xs text-ink-2">{formatNumber(o.stats?.eventsPublished ?? 0)} événements · inscrit {formatDate(o.createdAt)}</span></span>
                        <StatusBadge status={o.status} labels={ORGANIZER_STATUS} />
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(q.data.total / PAGE))} total={q.data.total} onChange={setPage} />}
            {open && (
                <Sheet open onClose={() => setOpen(null)} title={open.displayName}
                    footer={(
                        <div className="grid grid-cols-2 gap-2">
                            {open.status !== 'SUSPENDED' ? <Button variant="danger-soft" onClick={() => setAction('suspend')}>Suspendre…</Button> : <span />}
                            {open.status !== 'APPROVED' ? <Button variant="success" onClick={() => setAction('approve')}>{open.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver'}</Button> : <span />}
                        </div>
                    )}>
                    <div className="space-y-4">
                        <StatusBadge status={open.status} labels={ORGANIZER_STATUS} />
                        <MemberLink id={open.userId} name={open.displayName} phone={open.contactPhone} sub="Compte membre" />
                        {open.bio && <p className="text-sm text-ink-2 whitespace-pre-line">{open.bio}</p>}
                        <KeyValue items={[
                            ['Email', open.contactEmail || '—'], ['Téléphone', formatPhone(open.contactPhone)],
                            ['Événements publiés', formatNumber(open.stats?.eventsPublished ?? 0)], ['Billets vendus', formatNumber(open.stats?.ticketsSold ?? 0)],
                            ['Chiffre d’affaires', formatMoney(open.stats?.grossRevenue ?? 0)], ['Inscrit', formatDate(open.createdAt)],
                        ]} />
                    </div>
                </Sheet>
            )}
            {open && (
                <>
                    <ConfirmSheet open={action === 'approve'} onClose={() => setAction(null)} tone="success" title={`${open.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver'} ${open.displayName} ?`}
                        message={<p>Il aura accès à son espace organisateur pour créer et vendre ses événements.</p>} confirmLabel={open.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver'}
                        onConfirm={async () => { await approveOrganizer(open._id); notify.success('Organisateur approuvé.'); setOpen(null); refresh(); }} />
                    <ConfirmSheet open={action === 'suspend'} onClose={() => setAction(null)} tone="danger" title={`Suspendre ${open.displayName} ?`}
                        message={<p>Il perd l’accès à son espace organisateur. Ses événements déjà publiés restent en ligne : suspends-les un par un si besoin.</p>}
                        reason={{ label: 'Motif', suggestions: ['Événement frauduleux', 'Informations fausses', 'Plaintes répétées'], minLength: 5 }}
                        confirmLabel="Suspendre" onConfirm={async (reason) => { await suspendOrganizer(open._id, reason); notify.success('Organisateur suspendu.'); setOpen(null); refresh(); }} />
                </>
            )}
        </div>
    );
}
