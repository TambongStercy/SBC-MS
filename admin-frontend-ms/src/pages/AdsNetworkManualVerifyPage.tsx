import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Video, AlertTriangle } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { useToast } from '../hooks/useToast';
import {
    getManualVerifications,
    approveManualVerification,
    rejectManualVerification,
    apiErrorMessage,
    type ManualVerification,
} from '../api/adsNetwork';

/**
 * Video-proof verification review queue. Each item is a diffuseur's screen
 * recording showing the code we issued (proving freshness) then their WhatsApp
 * status views. The admin confirms the code matches, reads the view count off
 * the video, and approves (which verifies the day + credits) or rejects.
 */
export default function AdsNetworkManualVerifyPage() {
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [items, setItems] = useState<ManualVerification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actingOn, setActingOn] = useState<string | null>(null);

    // Per-card admin input: the views read off the video.
    const [views, setViews] = useState<Record<string, string>>({});
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [confirmApprove, setConfirmApprove] = useState<ManualVerification | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setItems(await getManualVerifications());
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger les vérifications.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const doApprove = async (mv: ManualVerification) => {
        const raw = views[mv.manualVerificationId];
        const count = Number(raw);
        if (!raw || !Number.isFinite(count) || count < 0) {
            showError('Indiquez le nombre de vues lu sur la vidéo.');
            return;
        }
        setActingOn(mv.manualVerificationId);
        try {
            await approveManualVerification(mv.manualVerificationId, count);
            showSuccess(`Jour ${mv.day} validé — ${count} vues créditées à ${mv.diffuseurName}.`);
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'La validation a échoué.'));
        } finally {
            setActingOn(null);
            setConfirmApprove(null);
        }
    };

    const doReject = async (mv: ManualVerification) => {
        const reason = rejectReason.trim();
        if (!reason) {
            showError('Indiquez un motif de refus.');
            return;
        }
        setActingOn(mv.manualVerificationId);
        try {
            await rejectManualVerification(mv.manualVerificationId, reason);
            showSuccess(`Vérification refusée. Le diffuseur peut recommencer.`);
            setRejectingId(null);
            setRejectReason('');
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'Le refus a échoué.'));
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div className="p-4 md:p-6">
            <Header title="Vérifications vidéo" />
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">
                    {items.length} vérification{items.length !== 1 ? 's' : ''} en attente
                </p>
                <button
                    onClick={fetchData}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                    <RefreshCw size={16} /> Actualiser
                </button>
            </div>

            {loading ? (
                <Loader />
            ) : error ? (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                    <AlertTriangle size={18} /> {error}
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 p-10 text-center text-gray-500">
                    <Video className="mx-auto mb-3 text-gray-300" size={40} />
                    Aucune vérification vidéo en attente.
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {items.map((mv) => (
                        <motion.div
                            key={mv.manualVerificationId}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                        >
                            <div className="mb-2 flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold text-gray-900">{mv.diffuseurName}</p>
                                    <p className="text-xs text-gray-500">
                                        {mv.diffuseurPhone ?? '—'} · Jour {mv.day} ·{' '}
                                        {mv.isTestCampaign ? 'Campagne test' : mv.campaignTitle}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-blue-50 px-3 py-1 text-center">
                                    <p className="text-[10px] uppercase text-gray-500">Code attendu</p>
                                    <p className="text-lg font-extrabold tracking-widest text-[#115CF6]">{mv.code}</p>
                                </div>
                            </div>

                            {mv.videoUrl ? (
                                <video src={mv.videoUrl} controls playsInline className="w-full rounded-xl bg-black" />
                            ) : (
                                <div className="rounded-xl bg-gray-100 p-6 text-center text-sm text-gray-500">
                                    Vidéo indisponible
                                </div>
                            )}

                            <p className="mt-2 text-xs text-gray-400">
                                Code émis {new Date(mv.codeIssuedAt).toLocaleString('fr-FR')}
                                {mv.uploadedAt && ` · reçue ${new Date(mv.uploadedAt).toLocaleString('fr-FR')}`}
                            </p>

                            {rejectingId === mv.manualVerificationId ? (
                                <div className="mt-3">
                                    <textarea
                                        value={rejectReason}
                                        onChange={(e) => setRejectReason(e.target.value)}
                                        placeholder="Motif du refus (visible par le diffuseur)"
                                        rows={2}
                                        className="w-full rounded-xl border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => doReject(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white disabled:bg-gray-300"
                                        >
                                            Confirmer le refus
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-700"
                                        >
                                            Annuler
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3">
                                    <label className="mb-1 block text-xs font-medium text-gray-600">
                                        Nombre de vues lu sur la vidéo
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        inputMode="numeric"
                                        value={views[mv.manualVerificationId] ?? ''}
                                        onChange={(e) => setViews((v) => ({ ...v, [mv.manualVerificationId]: e.target.value }))}
                                        placeholder="ex. 262"
                                        className="w-full rounded-xl border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#115CF6]"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => setConfirmApprove(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-medium text-white disabled:bg-gray-300"
                                        >
                                            Valider
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(mv.manualVerificationId); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-red-200 py-2 text-sm font-medium text-red-600"
                                        >
                                            Refuser
                                        </button>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>
            )}

            {confirmApprove && (
                <ConfirmationModal
                    isOpen={!!confirmApprove}
                    title="Valider cette vérification ?"
                    message={`Le jour ${confirmApprove.day} de ${confirmApprove.diffuseurName} sera validé avec ${views[confirmApprove.manualVerificationId] || 0} vues, et le diffuseur crédité. Confirmez que la vidéo montre bien le code ${confirmApprove.code} puis les vues du statut.`}
                    confirmText="Valider"
                    cancelText="Annuler"
                    onConfirm={() => doApprove(confirmApprove)}
                    onCancel={() => setConfirmApprove(null)}
                />
            )}
        </div>
    );
}
