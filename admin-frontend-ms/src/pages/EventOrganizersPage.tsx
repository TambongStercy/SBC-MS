import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import { AdminOrganizer, OrganizerStatus, listOrganizers, approveOrganizer, apiErrorMessage } from '../api/event';

const STATUS_STYLES: Record<OrganizerStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    SUSPENDED: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<OrganizerStatus, string> = {
    PENDING: 'En attente',
    APPROVED: 'Approuvé',
    SUSPENDED: 'Suspendu',
};

/**
 * Organisers: approve newcomers. There is no organiser suspension any more:
 * SBC accepts or refuses each event instead (Événements → « À valider »), so
 * one bad event never blocks an organiser's other events. Organisers suspended
 * before that change can still be reactivated here.
 */
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
        } catch (e: unknown) { showError(apiErrorMessage(e, 'Impossible de charger les organisateurs.')); }
        finally { setLoading(false); }
    }, [status, showError]);

    useEffect(() => { load(); }, [load]);

    const doApprove = (o: AdminOrganizer) => {
        const verb = o.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver';
        setConfirm({
            title: `${verb} l'organisateur`,
            message: `${o.displayName} aura accès à son espace organisateur pour créer ses événements. Chacun sera soumis à la validation de SBC avant d'être mis en vente.`,
            onConfirm: async () => {
                try {
                    await approveOrganizer(o._id);
                    showSuccess(o.status === 'SUSPENDED' ? 'Organisateur réactivé.' : 'Organisateur approuvé.');
                    setConfirm(null);
                    load();
                } catch (e: unknown) { showError(apiErrorMessage(e, 'Erreur.')); setConfirm(null); }
            },
        });
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Organisateurs" />
            <div className="space-y-4">
                <p className="text-sm text-fg-muted">
                    Il n'y a plus de suspension d'organisateur : SBC accepte ou refuse chaque événement envoyé
                    (page Événements, filtre « À valider »). Un événement refusé ne bloque pas les autres événements de l'organisateur.
                </p>
                <div className="flex items-center gap-3">
                    <select value={status} onChange={(e) => setStatus(e.target.value as OrganizerStatus | '')} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">
                        <option value="">Tous les statuts</option>
                        <option value="PENDING">En attente</option>
                        <option value="APPROVED">Approuvés</option>
                        <option value="SUSPENDED">Suspendus</option>
                    </select>
                    <button onClick={load} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">Actualiser</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="overflow-x-auto bg-surface rounded-xl border border-line">
                        <table className="min-w-full text-sm">
                            <thead className="bg-background/50 text-fg-muted">
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
                                    <tr><td colSpan={5} className="px-4 py-6 text-center text-fg-muted">Aucun organisateur.</td></tr>
                                )}
                                {items.map((o) => (
                                    <tr key={o._id} className="border-t border-line">
                                        <td className="px-4 py-2 font-medium">{o.displayName}</td>
                                        <td className="px-4 py-2">
                                            <div className="text-xs">{o.contactEmail}</div>
                                            <div className="text-xs text-fg-muted">{o.contactPhone}</div>
                                        </td>
                                        <td className="px-4 py-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[o.status]}`}>{STATUS_LABELS[o.status] ?? o.status}</span></td>
                                        <td className="px-4 py-2 text-xs">{o.stats?.eventsPublished ?? 0}</td>
                                        <td className="px-4 py-2 space-x-2">
                                            {o.status !== 'APPROVED' && <button onClick={() => doApprove(o)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-sm">{o.status === 'SUSPENDED' ? 'Réactiver' : 'Approuver'}</button>}
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
                    variant="success"
                    onConfirm={confirm.onConfirm}
                    onCancel={() => setConfirm(null)}
                />
            )}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
