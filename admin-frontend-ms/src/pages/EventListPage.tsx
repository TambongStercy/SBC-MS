import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import { AdminEvent, EventStatus, listAdminEvents, suspendAdminEvent, cancelAdminEvent, apiErrorMessage } from '../api/event';

const STATUS_STYLES: Record<EventStatus, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    PUBLISHED: 'bg-emerald-100 text-emerald-700',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
};

const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export default function EventListPage() {
    const [items, setItems] = useState<AdminEvent[]>([]);
    const [status, setStatus] = useState<EventStatus | ''>('');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // `q` is not yet in listAdminEvents' param type — remove the cast once api/event.ts declares it
            const { items } = await listAdminEvents({ status: status || undefined, q: q.trim() || undefined, limit: 100 });
            setItems(items);
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [status, q, showError]);

    // debounced so typing in the search box doesn't fire a request per keystroke
    useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

    const doSuspend = (ev: AdminEvent) => setConfirm({
        title: 'Suspendre l\'événement',
        message: `« ${ev.title} » ne sera plus visible dans les listes publiques. Les billets déjà vendus restent valides.`,
        onConfirm: async () => {
            try { await suspendAdminEvent(ev._id); showSuccess('Événement suspendu.'); setConfirm(null); load(); }
            catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    const doCancel = (ev: AdminEvent) => setConfirm({
        title: 'Annuler l\'événement',
        message: `« ${ev.title} » sera annulé. Vous devrez ensuite rembourser manuellement les billets vendus.`,
        onConfirm: async () => {
            try { await cancelAdminEvent(ev._id, 'Annulation administrateur'); showSuccess('Événement annulé.'); setConfirm(null); load(); }
            catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Événements" />
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Rechercher un titre ou une ville"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72"
                    />
                    <select value={status} onChange={(e) => setStatus(e.target.value as EventStatus | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous les statuts</option>
                        <option value="DRAFT">Brouillons</option>
                        <option value="PUBLISHED">Publiés</option>
                        <option value="SUSPENDED">Suspendus</option>
                        <option value="CANCELLED">Annulés</option>
                        <option value="COMPLETED">Terminés</option>
                    </select>
                    <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">Rafraîchir</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Titre</th>
                                    <th className="px-4 py-2 text-left">Statut</th>
                                    <th className="px-4 py-2 text-left">Date</th>
                                    <th className="px-4 py-2 text-left">Lieu</th>
                                    <th className="px-4 py-2 text-left">Ventes</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Aucun événement.</td></tr>
                                )}
                                {items.map((ev) => (
                                    <tr key={ev._id} className="border-t border-gray-100">
                                        <td className="px-4 py-2">
                                            <div className="font-medium">{ev.title}</div>
                                            <div className="text-xs text-gray-500">{ev.slug}</div>
                                        </td>
                                        <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[ev.status]}`}>{ev.status}</span></td>
                                        <td className="px-4 py-2 text-xs">{fmt(ev.startsAt)}</td>
                                        <td className="px-4 py-2 text-xs">{ev.venue} · {ev.city}</td>
                                        <td className="px-4 py-2 text-xs">
                                            {ev.totals?.ticketsSold ?? 0} billets · {(ev.totals?.grossRevenue ?? 0).toLocaleString('fr-FR')} XAF
                                        </td>
                                        <td className="px-4 py-2 space-x-2">
                                            {ev.status === 'PUBLISHED' && <button onClick={() => doSuspend(ev)} className="text-xs bg-amber-600 text-white px-2 py-1 rounded">Suspendre</button>}
                                            {ev.status !== 'CANCELLED' && ev.status !== 'COMPLETED' && <button onClick={() => doCancel(ev)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Annuler</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {confirm && (
                <ConfirmationModal
                    isOpen
                    title={confirm.title}
                    message={confirm.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    onConfirm={confirm.onConfirm}
                    onCancel={() => setConfirm(null)}
                />
            )}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
