import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Video, AlertTriangle, ExternalLink } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ToastContainer from '../components/common/ToastContainer';
import ReviewVideoPlayer from '../components/common/ReviewVideoPlayer';
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
                <p className="text-sm text-gray-400">
                    {items.length} vérification{items.length !== 1 ? 's' : ''} en attente
                </p>
                <button
                    onClick={fetchData}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700"
                >
                    <RefreshCw size={16} /> Actualiser
                </button>
            </div>

            {loading ? (
                <Loader name="Chargement des vérifications…" />
            ) : error ? (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300">
                    <AlertTriangle size={18} /> {error}
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-gray-700 bg-gray-800 bg-opacity-50 backdrop-blur-md p-10 text-center text-gray-400">
                    <Video className="mx-auto mb-3 text-gray-600" size={40} />
                    Aucune vérification vidéo en attente.
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {items.map((mv) => (
                        <motion.div
                            key={mv.manualVerificationId}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-gray-700 bg-gray-800 bg-opacity-50 backdrop-blur-md p-4 shadow-lg"
                        >
                            <div className="mb-2 flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold text-gray-100">{mv.diffuseurName}</p>
                                    <p className="text-xs text-gray-400">
                                        {mv.diffuseurPhone ?? '—'} · Jour {mv.day} ·{' '}
                                        {mv.isTestCampaign ? 'Campagne test' : mv.campaignTitle}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-center">
                                    <p className="text-[10px] uppercase text-gray-400">Code attendu</p>
                                    <p className="text-lg font-extrabold tracking-widest text-blue-400">{mv.code}</p>
                                </div>
                            </div>

                            {mv.videoUrl ? (
                                <>
                                    <ReviewVideoPlayer src={mv.videoUrl} />
                                    {/* Phones record screens as .mov/HEVC, which Chrome often cannot
                                        decode. The player then shows a black box with no explanation,
                                        so always offer a way out to a native player. */}
                                    <a
                                        href={mv.videoUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                    >
                                        <ExternalLink size={12} /> La vidéo ne se lance pas ? Ouvrir dans un nouvel onglet
                                    </a>
                                </>
                            ) : (
                                <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-6 text-center text-sm text-gray-400">
                                    Vidéo indisponible
                                </div>
                            )}

                            <p className="mt-2 text-xs text-gray-500">
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
                                        className="w-full rounded-xl border border-gray-600 bg-gray-900 p-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => doReject(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:bg-gray-600"
                                        >
                                            Confirmer le refus
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-gray-600 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700"
                                        >
                                            Annuler
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">
                                        Nombre de vues lu sur la vidéo
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        inputMode="numeric"
                                        value={views[mv.manualVerificationId] ?? ''}
                                        onChange={(e) => setViews((v) => ({ ...v, [mv.manualVerificationId]: e.target.value }))}
                                        placeholder="ex. 262"
                                        className="w-full rounded-xl border border-gray-600 bg-gray-900 p-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#115CF6]"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => setConfirmApprove(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:bg-gray-600"
                                        >
                                            Valider
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(mv.manualVerificationId); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-red-500/40 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
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
