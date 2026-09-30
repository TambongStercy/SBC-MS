import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    AdminResaleListing, ResaleListingStatus,
    listAdminResaleListings, suspendResaleListing, removeResaleListing, apiErrorMessage,
} from '../api/event';

const STATUS_STYLES: Record<ResaleListingStatus, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    SOLD: 'bg-blue-100 text-blue-800',
    CANCELLED: 'bg-gray-100 text-gray-500',
    EXPIRED: 'bg-gray-100 text-gray-500',
    SUSPENDED: 'bg-red-100 text-red-800',
};

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function EventListingsPage() {
    const [items, setItems] = useState<AdminResaleListing[]>([]);
    const [status, setStatus] = useState<ResaleListingStatus | ''>('ACTIVE');
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { items } = await listAdminResaleListings({ status: status || undefined, limit: 100 });
            setItems(items);
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [status, showError]);

    useEffect(() => { load(); }, [load]);

    const doSuspend = (l: AdminResaleListing) => setConfirm({
        title: 'Suspendre l\'annonce',
        message: 'L\'annonce sera retirée du marketplace. Le vendeur conservera son billet.',
        onConfirm: async () => {
            try { await suspendResaleListing(l._id); showSuccess('Annonce suspendue.'); setConfirm(null); load(); }
            catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    const doRemove = (l: AdminResaleListing) => setConfirm({
        title: 'Retirer l\'annonce',
        message: 'L\'annonce sera annulée définitivement. Le vendeur conservera son billet.',
        onConfirm: async () => {
            try { await removeResaleListing(l._id); showSuccess('Annonce retirée.'); setConfirm(null); load(); }
            catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
        },
    });

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Marketplace revente" />
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                    <select value={status} onChange={(e) => setStatus(e.target.value as ResaleListingStatus | '')} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous les statuts</option>
                        <option value="ACTIVE">En vente</option>
                        <option value="SOLD">Vendues</option>
                        <option value="CANCELLED">Annulées</option>
                        <option value="SUSPENDED">Suspendues</option>
                    </select>
                    <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">Rafraîchir</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Annonce</th>
                                    <th className="px-4 py-2 text-left">Statut</th>
                                    <th className="px-4 py-2 text-right">Prix original</th>
                                    <th className="px-4 py-2 text-right">Prix demandé</th>
                                    <th className="px-4 py-2 text-left">Publiée le</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 && (
                                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Aucune annonce.</td></tr>
                                )}
                                {items.map((l) => (
                                    <tr key={l._id} className="border-t border-gray-100">
                                        <td className="px-4 py-2 text-xs font-mono">{l._id.slice(-8)}</td>
                                        <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[l.status]}`}>{l.status}</span></td>
                                        <td className="px-4 py-2 text-right text-sm">{l.originalPrice.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-2 text-right text-sm font-semibold">{l.askingPrice.toLocaleString('fr-FR')} XAF</td>
                                        <td className="px-4 py-2 text-xs">{fmt(l.listedAt)}</td>
                                        <td className="px-4 py-2 space-x-2">
                                            {l.status === 'ACTIVE' && (
                                                <>
                                                    <button onClick={() => doSuspend(l)} className="text-xs bg-amber-600 text-white px-2 py-1 rounded">Suspendre</button>
                                                    <button onClick={() => doRemove(l)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Retirer</button>
                                                </>
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
