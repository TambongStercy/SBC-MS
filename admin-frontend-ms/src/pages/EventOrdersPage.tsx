import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    AdminOrder, OrderStatus, OrderKind,
    listAdminOrders, refundOrder, apiErrorMessage,
} from '../api/event';

const STATUS_STYLES: Record<OrderStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    PAID: 'bg-emerald-100 text-emerald-800',
    FAILED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-red-100 text-red-800',
    REFUNDED: 'bg-amber-100 text-amber-800',
};

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const objectId = (v: string) => /^[0-9a-f]{24}$/i.test(v.trim()) ? v.trim() : undefined;

export default function EventOrdersPage() {
    const [items, setItems] = useState<AdminOrder[]>([]);
    const [status, setStatus] = useState<OrderStatus | ''>('');
    const [kind, setKind] = useState<OrderKind | ''>('');
    const [eventId, setEventId] = useState('');
    const [userId, setUserId] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { items } = await listAdminOrders({
                status: status || undefined,
                kind: kind || undefined,
                // only sent once a full id is typed — the API casts it to an
                // ObjectId and 500s on a partial value
                eventId: objectId(eventId),
                userId: objectId(userId),
                limit: 100,
            });
            setItems(items);
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [status, kind, eventId, userId, showError]);

    // debounced so typing an id doesn't fire a request per keystroke
    useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

    const doRefund = (o: AdminOrder) => setConfirm({
        title: 'Rembourser la commande',
        message: `Rembourser ${o.total.toLocaleString('fr-FR')} XAF à l'acheteur ${o.holder.firstName} ${o.holder.lastName} ? Les billets seront invalidés et le solde principal de l'acheteur sera crédité.`,
        onConfirm: async () => {
            try {
                await refundOrder(o._id, 'Remboursement administrateur');
                showSuccess('Commande remboursée.');
                setConfirm(null);
                load();
            } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Commandes" />
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous les statuts</option>
                        <option value="PAID">Payées</option>
                        <option value="PENDING">En attente</option>
                        <option value="FAILED">Échouées</option>
                        <option value="CANCELLED">Annulées</option>
                        <option value="REFUNDED">Remboursées</option>
                    </select>
                    <select value={kind} onChange={(e) => setKind(e.target.value as OrderKind | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Toutes les commandes</option>
                        <option value="PRIMARY">Vente primaire</option>
                        <option value="RESALE">Revente</option>
                    </select>
                    <input
                        value={eventId}
                        onChange={(e) => setEventId(e.target.value)}
                        placeholder="ID événement"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 font-mono"
                    />
                    <input
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        placeholder="ID acheteur"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 font-mono"
                    />
                    <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">Rafraîchir</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Commande</th>
                                    <th className="px-4 py-2 text-left">Acheteur</th>
                                    <th className="px-4 py-2 text-left">Type</th>
                                    <th className="px-4 py-2 text-left">Statut</th>
                                    <th className="px-4 py-2 text-right">Total</th>
                                    <th className="px-4 py-2 text-left">Payée le</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Aucune commande.</td></tr>
                                )}
                                {items.map((o) => (
                                    <tr key={o._id} className="border-t border-gray-100">
                                        <td className="px-4 py-2 text-xs font-mono">{o._id.slice(-8)}</td>
                                        <td className="px-4 py-2">
                                            <div className="font-medium">{o.holder.firstName} {o.holder.lastName}</div>
                                            <div className="text-xs text-gray-500">{o.holder.phone}</div>
                                            {o.holder.email && <div className="text-xs text-gray-500">{o.holder.email}</div>}
                                        </td>
                                        <td className="px-4 py-2 text-xs">
                                            <span className={`px-2 py-1 rounded-full ${o.kind === 'RESALE' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>{o.kind}</span>
                                        </td>
                                        <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[o.status]}`}>{o.status}</span></td>
                                        <td className="px-4 py-2 text-right text-sm font-semibold">{o.total.toLocaleString('fr-FR')} XAF</td>
                                        <td className="px-4 py-2 text-xs">{fmt(o.paidAt)}</td>
                                        <td className="px-4 py-2">
                                            {o.status === 'PAID' && o.kind === 'PRIMARY' && (
                                                <button onClick={() => doRefund(o)} className="text-xs bg-amber-600 text-white px-2 py-1 rounded">Rembourser</button>
                                            )}
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
