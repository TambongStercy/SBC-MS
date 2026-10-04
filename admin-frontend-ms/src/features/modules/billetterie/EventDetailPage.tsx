import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAdminEvent, cancelAdminEvent, getAdminEvent, listAdminTickets, rejectAdminEvent, suspendAdminEvent, type AdminTicket, type TicketStatus } from '../../../api/event';
import { Button, Card, ConfirmSheet, DataList, EmptyState, ErrorState, KeyValue, Page, Pagination, SearchInput, Select, Skeleton, Stat, StatusBadge, Tabs, notify, type Column } from '../../../ui';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { useDebounced, useParamState } from '../../../lib/hooks';
import { EVENT_STATUS, TICKET_STATUS, eventPlace } from './shared';
import { OrdersTab } from './OrdersTab';

const PAGE = 20;

function Tickets({ eventId }: { eventId: string }) {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<'' | TicketStatus>('');
    const [page, setPage] = useState(1);
    const q = useDebounced(search);
    const list = useQuery({ queryKey: ['events', 'tickets', eventId, q, status, page], queryFn: () => listAdminTickets({ eventId, q: q || undefined, status: status || undefined, limit: PAGE, skip: (page - 1) * PAGE }), placeholderData: keepPreviousData });
    const cols: Column<AdminTicket>[] = [
        { key: 's', header: 'Billet', cell: t => <span className="font-mono font-semibold">{t.serial}</span> },
        { key: 'h', header: 'Participant', cell: t => <span><span className="block font-semibold">{t.holderName}</span><span className="block text-xs text-ink-2">{t.holderPhone}</span></span> },
        { key: 'st', header: 'Statut', cell: t => <StatusBadge status={t.status} labels={TICKET_STATUS} /> },
        { key: 'c', header: 'Entrée', cell: t => <span className="text-ink-2">{t.checkedInAt ? formatDateTime(t.checkedInAt) : '—'}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
                <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="N° de billet, nom ou téléphone" />
                <div className="sm:w-48"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as TicketStatus | ''); setPage(1); }}>
                    <option value="">Tous</option>{Object.entries(TICKET_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
                </Select></div>
            </div>
            <DataList rows={list.data?.items} columns={cols} rowKey={t => t._id} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
                empty={<EmptyState title="Aucun billet" />}
                card={t => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-mono font-semibold">{t.serial}</span><span className="block text-xs text-ink-2 truncate">{t.holderName} · {t.holderPhone}</span></span>
                        <StatusBadge status={t.status} labels={TICKET_STATUS} />
                    </span>
                )} />
            {list.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.total / PAGE))} total={list.data.total} onChange={setPage} />}
        </div>
    );
}

/**
 * One event: its figures, its orders and tickets, and the admin actions.
 * An event sent for review is accepted (published, tickets on sale) or
 * refused with a reason the organizer sees; the organizer can then edit it
 * and send it again. Refusing never blocks the organizer's other events.
 * Cancelling refunds every paid order automatically (event-service
 * cancelEventAndCascade): buyers credited, tickets voided, resale listings
 * withdrawn, buyers notified.
 */
export default function EventDetailPage() {
    const { eventId = '' } = useParams();
    const qc = useQueryClient();
    const [tab, setTab] = useParamState('onglet', 'commandes');
    const [action, setAction] = useState<'suspend' | 'cancel' | 'approve' | 'reject' | null>(null);
    const ev = useQuery({ queryKey: ['events', 'event', eventId], queryFn: () => getAdminEvent(eventId), enabled: !!eventId });
    const e = ev.data;
    const refresh = () => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['queue', 'events'] }); };

    return (
        <Page title={e?.title || 'Événement'} back="/modules/billetterie?onglet=evenements" subtitle={e ? `${formatDateTime(e.startsAt)} · ${e.city}` : undefined}>
            {ev.isLoading ? <Skeleton className="h-48 rounded-card" /> : ev.isError || !e ? <ErrorState message="Événement introuvable." onRetry={() => ev.refetch()} /> : (
                <div className="space-y-4">
                    <Card className="space-y-3">
                        <StatusBadge status={e.status} labels={EVENT_STATUS} />
                        <KeyValue items={[
                            ['Lieu', eventPlace(e) || '—'],
                            e.category === 'webinaire' && ['Lien WhatsApp', e.accessLink
                                ? <a href={e.accessLink} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{e.accessLink}</a>
                                : <span className="text-danger">Pas encore renseigné</span>],
                            ['Début', formatDateTime(e.startsAt)], ['Fin', formatDateTime(e.endsAt)],
                            !!e.submittedAt && ['Envoyé pour validation', formatDateTime(e.submittedAt)],
                            !!e.reviewedAt && [e.status === 'REJECTED' ? 'Refusé le' : 'Validé le', formatDateTime(e.reviewedAt)],
                            e.status === 'REJECTED' && !!e.rejectionReason && ['Motif du refus', e.rejectionReason],
                        ]} />
                        {e.status === 'PENDING_REVIEW' && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <Button variant="danger-soft" onClick={() => setAction('reject')}>Refuser…</Button>
                                <Button variant="success" onClick={() => setAction('approve')}>Accepter</Button>
                            </div>
                        )}
                        {(e.status === 'PUBLISHED' || e.status === 'SUSPENDED' || e.status === 'DRAFT') && (
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                {e.status === 'PUBLISHED' ? <Button variant="secondary" onClick={() => setAction('suspend')}>Suspendre…</Button> : <span />}
                                <Button variant="danger-soft" onClick={() => setAction('cancel')}>Annuler…</Button>
                            </div>
                        )}
                    </Card>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <Stat label="Billets vendus" value={formatNumber(e.totals?.ticketsSold ?? 0)} />
                        <Stat label="Entrés" value={formatNumber(e.totals?.checkedIn ?? 0)} />
                        <div className="col-span-2 sm:col-span-1"><Stat label="Ventes" value={formatMoney(e.totals?.grossRevenue ?? 0)} /></div>
                    </div>
                    <Tabs value={tab} onChange={setTab} items={[{ value: 'commandes', label: 'Commandes' }, { value: 'billets', label: 'Billets' }]} />
                    {tab === 'billets' ? <Tickets eventId={e._id} /> : <OrdersTab eventId={e._id} />}

                    <ConfirmSheet open={action === 'approve'} onClose={() => setAction(null)} tone="success" title={`Accepter « ${e.title} » ?`}
                        message={<p>L’événement est publié et ses billets mis en vente. L’organisateur est prévenu.</p>} confirmLabel="Accepter et publier"
                        onConfirm={async () => { await approveAdminEvent(e._id); notify.success('Événement accepté et publié.'); refresh(); }} />
                    <ConfirmSheet open={action === 'reject'} onClose={() => setAction(null)} tone="danger" title={`Refuser « ${e.title} » ?`}
                        message={<p>Il n’est pas publié. L’organisateur reçoit le motif et peut modifier son événement puis l’envoyer à nouveau. Son compte et ses autres événements ne sont pas touchés.</p>}
                        reason={{ label: 'Motif (envoyé à l’organisateur)', suggestions: ['Informations incomplètes', 'Affiche ou description inappropriée', 'Date ou lieu incohérent', 'Lien WhatsApp manquant ou invalide'], minLength: 5 }}
                        confirmLabel="Refuser"
                        onConfirm={async (reason) => { await rejectAdminEvent(e._id, reason); notify.success('Événement refusé : l’organisateur est prévenu.'); refresh(); }} />
                    <ConfirmSheet open={action === 'suspend'} onClose={() => setAction(null)} title="Suspendre cet événement ?"
                        message={<p>Il n’est plus en vente. Les billets déjà vendus restent valables.</p>} confirmLabel="Suspendre"
                        onConfirm={async () => { await suspendAdminEvent(e._id); notify.success('Événement suspendu.'); refresh(); }} />
                    <ConfirmSheet open={action === 'cancel'} onClose={() => setAction(null)} tone="danger" title="Annuler cet événement ?"
                        message={<>
                            <p>Toutes les commandes payées sont <b className="text-ink">remboursées automatiquement</b> sur le solde des acheteurs, leurs billets annulés, les annonces de revente retirées, et les acheteurs prévenus.</p>
                            <p>C’est définitif.</p>
                        </>}
                        reason={{ label: 'Motif (envoyé aux acheteurs)', suggestions: ['Événement reporté', 'Lieu indisponible', 'Organisateur défaillant'], minLength: 5 }}
                        confirmLabel="Annuler et rembourser"
                        onConfirm={async (reason) => {
                            const r = await cancelAdminEvent(e._id, reason) as unknown as { refundStats?: { processed: number; refunded: number; failed: number } };
                            const s = r?.refundStats;
                            notify.success(s ? `Événement annulé : ${s.refunded} commande(s) remboursée(s)${s.failed ? `, ${s.failed} crédit(s) seront retentés automatiquement` : ''}.` : 'Événement annulé.');
                            refresh();
                        }} />
                </div>
            )}
        </Page>
    );
}
