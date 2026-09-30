import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import { AdminOrganizer, OrganizerStatus, listOrganizers, approveOrganizer, suspendOrganizer, apiErrorMessage } from '../api/event';

const STATUS_STYLES: Record<OrganizerStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    SUSPENDED: 'bg-red-100 text-red-800',
};

export default function EventOrganizersPage() {
    const [items, setItems] = useState<AdminOrganizer[]>([]);
    const [status, setStatus] = useState<OrganizerStatus | ''>('');
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { items } = await listOrganizers({ status: status || undefined, limit: 100 });
            setItems(items);
        } catch (e: any) { showError(apiErrorMessage(e, 'Impossible de charger les organisateurs.')); }
        finally { setLoading(false); }
    }, [status, showError]);

    useEffect(() => { load(); }, [load]);

    const doApprove = (o: AdminOrganizer) => setConfirm({
        title: 'Approuver l\'organisateur',
        message: `${o.displayName} pourra créer et publier des événements.`,
        onConfirm: async () => {
            try {
                await approveOrganizer(o._id);
                showSuccess('Organisateur approuvé.');
                setConfirm(null);
                load();
            } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    const doSuspend = (o: AdminOrganizer) => setConfirm({
        title: 'Suspendre l\'organisateur',
        message: `${o.displayName} ne pourra plus créer de nouveaux événements.`,
        onConfirm: async () => {
            try {
                await suspendOrganizer(o._id);
                showSuccess('Organisateur suspendu.');
                setConfirm(null);
                load();
            } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Organisateurs" />
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                    <select value={status} onChange={(e) => setStatus(e.target.value as OrganizerStatus | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous les statuts</option>
                        <option value="PENDING">En attente</option>
                        <option value="APPROVED">Approuvés</option>
                        <option value="SUSPENDED">Suspendus</option>
                    </select>
                    <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">Rafraîchir</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Nom</th>
                                    <th className="px-4 py-2 text-left">Contact</th>
                                    <th className="px-4 py-2 text-left">Statut</th>
                                    <th className="px-4 py-2 text-left">Événements</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Aucun organisateur.</td></tr>
                                )}
                                {items.map((o) => (
                                    <tr key={o._id} className="border-t border-gray-100">
                                        <td className="px-4 py-2 font-medium">{o.displayName}</td>
                                        <td className="px-4 py-2">
                                            <div className="text-xs">{o.contactEmail}</div>
                                            <div className="text-xs text-gray-500">{o.contactPhone}</div>
                                        </td>
                                        <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[o.status]}`}>{o.status}</span></td>
                                        <td className="px-4 py-2 text-xs">{o.stats?.eventsPublished ?? 0}</td>
                                        <td className="px-4 py-2 space-x-2">
                                            {o.status !== 'APPROVED' && <button onClick={() => doApprove(o)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Approuver</button>}
                                            {o.status !== 'SUSPENDED' && <button onClick={() => doSuspend(o)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Suspendre</button>}
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
