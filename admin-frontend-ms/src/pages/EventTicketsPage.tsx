import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    AdminTicket, TicketStatus, AdminEvent,
    listAdminTickets, listAdminEvents, apiErrorMessage,
} from '../api/event';

const STATUS_STYLES: Record<TicketStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    ISSUED: 'bg-emerald-100 text-emerald-800',
    CHECKED_IN: 'bg-blue-100 text-blue-800',
    CANCELLED: 'bg-red-100 text-red-800',
    REFUNDED: 'bg-amber-100 text-amber-800',
    EXPIRED: 'bg-gray-100 text-gray-500',
};

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function EventTicketsPage() {
    const [items, setItems] = useState<AdminTicket[]>([]);
    const [total, setTotal] = useState(0);
    const [events, setEvents] = useState<AdminEvent[]>([]);
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<TicketStatus | ''>('');
    const [eventId, setEventId] = useState('');
    const [loading, setLoading] = useState(true);
    const { toasts, removeToast, showError } = useToast();

    // ponytail: the API returns raw eventId/ticketTypeId, so the event title is
    // joined client-side from the first 100 events. Drop this once the backend
    // returns eventTitle/ticketTypeName on the ticket.
    useEffect(() => {
        listAdminEvents({ limit: 100 }).then(({ items }) => setEvents(items)).catch(() => { });
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { items, total } = await listAdminTickets({
                q: q.trim() || undefined,
                status: status || undefined,
                eventId: eventId || undefined,
                limit: 100,
            });
            setItems(items);
            setTotal(total);
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [q, status, eventId, showError]);

    // debounced so typing in the search box doesn't fire a request per keystroke
    useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

    const eventTitle = (id: string) => events.find((e) => e._id === id)?.title;

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Billets" />
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="N° de billet, nom ou téléphone"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72"
                    />
                    <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous les statuts</option>
                        <option value="PENDING">En attente</option>
                        <option value="ISSUED">Émis</option>
                        <option value="CHECKED_IN">Entrés</option>
                        <option value="CANCELLED">Annulés</option>
                        <option value="REFUNDED">Remboursés</option>
                        <option value="EXPIRED">Expirés</option>
                    </select>
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm max-w-xs">
                        <option value="">Tous les événements</option>
                        {events.map((ev) => <option key={ev._id} value={ev._id}>{ev.title}</option>)}
                    </select>
                    <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">Rafraîchir</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <>
                        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left">N° de billet</th>
                                        <th className="px-4 py-2 text-left">Participant</th>
                                        <th className="px-4 py-2 text-left">Événement</th>
                                        <th className="px-4 py-2 text-left">Type de billet</th>
                                        <th className="px-4 py-2 text-left">Statut</th>
                                        <th className="px-4 py-2 text-left">Date d'achat</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.length === 0 && (
                                        <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Aucun billet.</td></tr>
                                    )}
                                    {items.map((t) => (
                                        <tr key={t._id} className="border-t border-gray-100">
                                            <td className="px-4 py-2 text-xs font-mono">{t.serial}</td>
                                            <td className="px-4 py-2">
                                                <div className="font-medium">{t.holderName}</div>
                                                <div className="text-xs text-gray-500">{t.holderPhone}</div>
                                                {t.holderEmail && <div className="text-xs text-gray-500">{t.holderEmail}</div>}
                                            </td>
                                            <td className="px-4 py-2 text-xs">
                                                {eventTitle(t.eventId) || <span className="font-mono text-gray-500">{t.eventId.slice(-8)}</span>}
                                            </td>
                                            <td className="px-4 py-2 text-xs font-mono text-gray-500">{(t as any).ticketTypeId?.slice(-8) || '—'}</td>
                                            <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[t.status]}`}>{t.status}</span></td>
                                            <td className="px-4 py-2 text-xs">{fmt(t.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {total > items.length && (
                            <div className="text-xs text-gray-500">{items.length} billets affichés sur {total.toLocaleString('fr-FR')} — affinez la recherche.</div>
                        )}
                    </>
                )}
            </div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
