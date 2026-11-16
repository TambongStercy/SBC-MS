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
    const [confirmBan, setConfirmBan] = useState<ManualVerification | null>(null);

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

    const doReject = async (mv: ManualVerification, ban = false) => {
        const reason = rejectReason.trim();
        if (!reason) {
            showError('Indiquez un motif de refus.');
            return;
        }
        setActingOn(mv.manualVerificationId);
        try {
            await rejectManualVerification(mv.manualVerificationId, reason, ban);
            showSuccess(
                ban
                    ? `Vérification refusée et ${mv.diffuseurName} banni du réseau diffuseur.`
                    : 'Vérification refusée. Le diffuseur peut recommencer.',
            );
            setRejectingId(null);
            setRejectReason('');
            setConfirmBan(null);
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, ban ? 'Le bannissement a échoué.' : 'Le refus a échoué.'));
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div>
            <Header title="Vérifications vidéo" />
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-fg-muted">
                    {items.length} vérification{items.length !== 1 ? 's' : ''} en attente
                </p>
                <button
                    onClick={fetchData}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
                >
                    <RefreshCw size={16} /> Actualiser
                </button>
            </div>

            {loading ? (
                <Loader name="Chargement des vérifications…" />
            ) : error ? (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
                    <AlertTriangle size={18} /> {error}
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-line bg-surface p-10 text-center text-fg-muted">
                    <Video className="mx-auto mb-3 text-fg-subtle" size={40} />
                    Aucune vérification vidéo en attente.
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {items.map((mv) => (
                        <motion.div
                            key={mv.manualVerificationId}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-line bg-surface p-4"
                        >
                            <div className="mb-2 flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-semibold text-fg">{mv.diffuseurName}</p>
                                    <p className="text-xs text-fg-muted">
                                        {mv.diffuseurPhone ?? '—'} · Jour {mv.day} ·{' '}
                                        {mv.isTestCampaign ? 'Campagne test' : mv.campaignTitle}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-center">
                                    <p className="text-[10px] uppercase text-fg-muted">Code attendu</p>
                                    <p className="text-lg font-extrabold tracking-widest text-blue-600 dark:text-blue-400">{mv.code}</p>
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
                                        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                                    >
                                        <ExternalLink size={12} /> La vidéo ne se lance pas ? Ouvrir dans un nouvel onglet
                                    </a>
                                </>
                            ) : (
                                <div className="rounded-xl border border-line bg-background/60 p-6 text-center text-sm text-fg-muted">
                                    Vidéo indisponible
                                </div>
                            )}

                            <p className="mt-2 text-xs text-fg-subtle">
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
                                        className="w-full rounded-xl border border-line-strong bg-background p-2 text-sm text-fg placeholder-fg-subtle focus:outline-hidden focus:ring-2 focus:ring-red-400"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => doReject(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:bg-gray-400 dark:disabled:bg-gray-600"
                                        >
                                            Confirmer le refus
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-line-strong py-2 text-sm font-medium text-fg-muted hover:bg-surface-2"
                                        >
                                            Annuler
                                        </button>
                                    </div>
                                    {/* Banning belongs here, at the moment you are
                                        looking at the proof. On its own screen it is
                                        the step that gets skipped. */}
                                    <div className="mt-2">
                                        <button
                                            onClick={() => setConfirmBan(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="w-full rounded-xl border border-red-500/60 bg-red-500/10 py-2 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-500/20"
                                        >
                                            Refuser et bannir ce diffuseur du réseau
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3">
                                    <label className="mb-1 block text-xs font-medium text-fg-muted">
                                        Nombre de vues lu sur la vidéo
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        inputMode="numeric"
                                        value={views[mv.manualVerificationId] ?? ''}
                                        onChange={(e) => setViews((v) => ({ ...v, [mv.manualVerificationId]: e.target.value }))}
                                        placeholder="ex. 262"
                                        className="w-full rounded-xl border border-line-strong bg-background p-2 text-sm text-fg placeholder-fg-subtle focus:outline-hidden focus:ring-2 focus:ring-[#115CF6]"
                                    />
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            onClick={() => setConfirmApprove(mv)}
                                            disabled={actingOn === mv.manualVerificationId}
                                            className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:bg-gray-400 dark:disabled:bg-gray-600"
                                        >
                                            Valider
                                        </button>
                                        <button
                                            onClick={() => { setRejectingId(mv.manualVerificationId); setRejectReason(''); }}
                                            className="flex-1 rounded-xl border border-red-500/40 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10"
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

            {confirmBan && (
                <ConfirmationModal
                    isOpen={!!confirmBan}
                    title={`Bannir ${confirmBan.diffuseurName} du réseau diffuseur ?`}
                    message={
                        `La vérification sera refusée et ${confirmBan.diffuseurName} ne recevra plus aucune `
                        + `campagne. Ses offres en attente sont retirées. Son compte SBC reste intact — `
                        + `seul l'accès au réseau diffuseur est bloqué, et le bannissement peut être levé. `
                        + `Motif enregistré : « ${rejectReason.trim()} ».`
                    }
                    confirmText="Refuser et bannir"
                    cancelText="Annuler"
                    onConfirm={() => doReject(confirmBan, true)}
                    onCancel={() => setConfirmBan(null)}
                />
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
