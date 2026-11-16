import { useCallback, useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    AdminDispute, DisputeStatus,
    listAdminDisputes, resolveDispute, apiErrorMessage,
} from '../api/event';

const STATUS_STYLES: Record<DisputeStatus, string> = {
    OPEN: 'bg-amber-100 text-amber-800',
    RESOLVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800',
};

const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function EventDisputesPage() {
    const [items, setItems] = useState<AdminDispute[]>([]);
    const [status, setStatus] = useState<DisputeStatus | ''>('OPEN');
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState<{ dispute: AdminDispute; outcome: 'resolve' | 'reject'; note: string } | null>(null);
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { items } = await listAdminDisputes({ status: status || undefined, limit: 100 });
            setItems(items);
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
        finally { setLoading(false); }
    }, [status, showError]);

    useEffect(() => { load(); }, [load]);

    const submit = async () => {
        if (!modal) return;
        if (!modal.note.trim()) { showError('Ajoutez une note explicative.'); return; }
        try {
            await resolveDispute(modal.dispute._id, modal.note.trim(), modal.outcome);
            showSuccess(modal.outcome === 'resolve' ? 'Litige résolu.' : 'Litige rejeté.');
            setModal(null);
            load();
        } catch (e: any) { showError(apiErrorMessage(e, 'Erreur.')); }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Litiges" />
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <select value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus | '')} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">
                        <option value="">Tous</option>
                        <option value="OPEN">Ouverts</option>
                        <option value="RESOLVED">Résolus</option>
                        <option value="REJECTED">Rejetés</option>
                    </select>
                    <button onClick={load} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">Actualiser</button>
                </div>

                {loading ? <Loader name="Chargement..." /> : (
                    <div className="space-y-3">
                        {items.length === 0 && <div className="text-center text-fg-muted py-8">Aucun litige.</div>}
                        {items.map((d) => (
                            <div key={d._id} className="bg-surface rounded-xl border border-line p-4">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="text-xs uppercase text-fg-muted">{d.kind}</div>
                                        <div className="text-xs text-fg-muted mt-0.5">{fmt(d.createdAt)}</div>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                                </div>
                                <p className="mt-3 text-sm text-fg-muted whitespace-pre-wrap">{d.description}</p>
                                <div className="text-xs text-fg-muted mt-2">
                                    {d.ticketId && <>Billet : <span className="font-mono">{d.ticketId.slice(-8)}</span> · </>}
                                    {d.resaleOrderId && <>Revente : <span className="font-mono">{d.resaleOrderId.slice(-8)}</span></>}
                                </div>
                                {d.status === 'OPEN' && (
                                    <div className="mt-3 flex gap-2">
                                        <button onClick={() => setModal({ dispute: d, outcome: 'resolve', note: '' })} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-sm">Résoudre</button>
                                        <button onClick={() => setModal({ dispute: d, outcome: 'reject', note: '' })} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-sm">Rejeter</button>
                                    </div>
                                )}
                                {d.resolutionNote && (
                                    <div className="mt-3 border-t border-line pt-3 text-xs">
                                        <div className="text-fg-muted">Note de résolution :</div>
                                        <div className="text-fg-muted">{d.resolutionNote}</div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {modal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-surface rounded-xl p-5 w-full max-w-md">
                        <h3 className="text-base font-semibold mb-2">
                            {modal.outcome === 'resolve' ? 'Résoudre le litige' : 'Rejeter le litige'}
                        </h3>
                        <p className="text-sm text-fg-muted mb-3">Ajoutez une note décrivant la décision (obligatoire).</p>
                        <textarea
                            value={modal.note}
                            onChange={(e) => setModal({ ...modal, note: e.target.value })}
                            placeholder="Note de résolution"
                            rows={4}
                            className="w-full border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg"
                            autoFocus
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button onClick={() => setModal(null)} className="text-sm bg-surface-2 text-fg-muted px-4 py-2 rounded-lg">Annuler</button>
                            <button
                                onClick={submit}
                                className={`text-sm text-fg px-4 py-2 rounded-lg ${modal.outcome === 'resolve' ? 'bg-emerald-600' : 'bg-red-600'}`}
                            >
                                Confirmer
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
