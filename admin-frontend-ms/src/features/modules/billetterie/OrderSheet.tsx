import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminTickets, refundOrder, type AdminOrder } from '../../../api/event';
import { Badge, Button, ConfirmSheet, KeyValue, MemberLink, SectionTitle, Sheet, Spinner, StatusBadge, notify } from '../../../ui';
import { formatDateTime, formatMoney } from '../../../lib/format';
import { ORDER_KIND, ORDER_STATUS, TICKET_STATUS } from './shared';

/**
 * One order with its tickets. Refunding (paid orders only) is verified in
 * event-service refund.service: the order and its tickets are voided, active
 * resale listings withdrawn, the buyer's main balance credited, the buyer told.
 * A resale order also debits the seller what they received.
 */
export function OrderSheet({ order: o, eventTitle, onClose }: { order: AdminOrder; eventTitle: string; onClose: () => void }) {
    const qc = useQueryClient();
    const [confirm, setConfirm] = useState(false);
    const tickets = useQuery({
        queryKey: ['events', 'order-tickets', o._id],
        queryFn: async () => (await listAdminTickets({ eventId: o.eventId, limit: 200 })).items.filter(t => t.orderId === o._id),
    });
    const resale = o.kind === 'RESALE';
    return (
        <Sheet open onClose={onClose} title="Commande" size="lg"
            footer={o.status === 'PAID' ? <Button variant="danger-soft" full onClick={() => setConfirm(true)}>Rembourser {formatMoney(o.total)}</Button> : undefined}>
            <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5"><StatusBadge status={o.status} labels={ORDER_STATUS} /><StatusBadge status={o.kind} labels={ORDER_KIND} /></div>
                <MemberLink id={o.userId} name={`${o.holder.firstName} ${o.holder.lastName}`.trim()} phone={o.holder.phone} sub={o.holder.email} />
                <KeyValue items={[
                    ['Événement', eventTitle],
                    ['Billets', formatMoney(o.subtotal)], ['Commission SBC', formatMoney(o.commission)], ['Total payé', formatMoney(o.total)],
                    ['Créée', formatDateTime(o.createdAt)], o.paidAt ? ['Payée', formatDateTime(o.paidAt)] : null,
                ]} />
                <div>
                    <SectionTitle>Billets</SectionTitle>
                    {tickets.isLoading ? <Spinner className="py-4" /> : !tickets.data?.length ? <p className="text-sm text-ink-3">Aucun billet émis pour cette commande.</p> : (
                        <ul className="divide-y divide-border border border-border rounded-tile">
                            {tickets.data.map(t => (
                                <li key={t._id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                                    <span className="min-w-0"><span className="block font-mono font-semibold">{t.serial}</span><span className="block text-xs text-ink-2 truncate">{t.holderName}{t.checkedInAt ? ` · entré ${formatDateTime(t.checkedInAt)}` : ''}</span></span>
                                    <span className="flex items-center gap-1.5">{t.previousTicketId && <Badge>revendu</Badge>}<StatusBadge status={t.status} labels={TICKET_STATUS} /></span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="danger" title={`Rembourser ${formatMoney(o.total)} ?`}
                message={<>
                    <p>La commande et ses billets sont annulés, et {o.holder.firstName} est crédité de {formatMoney(o.total)} sur son solde. Il est prévenu.</p>
                    {resale && <p>C’est une revente : le vendeur est débité de ce qu’il avait reçu (son solde peut devenir négatif s’il l’a déjà retiré).</p>}
                </>}
                reason={{ label: 'Motif', suggestions: ['Demande du client', 'Événement modifié', 'Billet invalide'], minLength: 3 }}
                confirmLabel="Rembourser"
                onConfirm={async (reason) => { await refundOrder(o._id, reason); notify.success('Commande remboursée.'); qc.invalidateQueries({ queryKey: ['events'] }); onClose(); }} />
        </Sheet>
    );
}
