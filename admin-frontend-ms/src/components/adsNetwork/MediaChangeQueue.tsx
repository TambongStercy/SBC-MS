import React, { useCallback, useEffect, useState } from 'react';
import { ImageUp } from 'lucide-react';
import ConfirmationModal from '../common/ConfirmationModal';
import { getFileUrl } from '../../utils/fileUtils';
import {
    AdsMediaChange,
    apiErrorMessage,
    approveAdsMediaChange,
    getAdsMediaChanges,
    rejectAdsMediaChange,
} from '../../api/adsNetwork';

interface Props {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
}

const Creative: React.FC<{ fileId: string; type: 'image' | 'video'; label: string }> = ({ fileId, type, label }) => (
    <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        {type === 'video' ? (
            <video src={getFileUrl(fileId)} controls preload="metadata" className="w-full max-h-72 rounded-lg bg-black" />
        ) : (
            <img src={getFileUrl(fileId)} alt={label} className="w-full max-h-72 object-contain rounded-lg bg-gray-900" />
        )}
    </div>
);

/**
 * New creatives proposed for campaigns already being diffused.
 *
 * The current creative keeps running until one of these is approved, so the
 * two are shown side by side. Renders nothing when the queue is empty.
 */
const MediaChangeQueue: React.FC<Props> = ({ showSuccess, showError }) => {
    const [items, setItems] = useState<AdsMediaChange[]>([]);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [confirmApprove, setConfirmApprove] = useState<AdsMediaChange | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setItems(await getAdsMediaChanges());
        } catch (err) {
            showError(apiErrorMessage(err, 'Impossible de charger les nouveaux visuels'));
        }
    }, [showError]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleApprove = async (item: AdsMediaChange) => {
        setActingOn(item._id);
        try {
            await approveAdsMediaChange(item._id);
            showSuccess(`Nouveau visuel de « ${item.title} » validé. L'annonceur et les diffuseurs en cours sont prévenus.`);
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'La validation a échoué.'));
        } finally {
            setActingOn(null);
            setConfirmApprove(null);
        }
    };

    const handleReject = async (item: AdsMediaChange) => {
        const reason = rejectReason.trim();
        if (!reason) {
            showError("Indiquez un motif : sans lui l'annonceur ne sait pas quoi corriger.");
            return;
        }
        setActingOn(item._id);
        try {
            await rejectAdsMediaChange(item._id, reason);
            showSuccess(`Nouveau visuel de « ${item.title} » refusé. L'annonceur garde son visuel actuel.`);
            setRejectingId(null);
            setRejectReason('');
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'Le refus a échoué.'));
        } finally {
            setActingOn(null);
        }
    };

    if (items.length === 0) return null;

    return (
        <div className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-indigo-700 mb-6">
            <div className="flex items-center gap-2 mb-4">
                <ImageUp className="text-indigo-400" size={20} />
                <h2 className="text-lg font-semibold text-gray-100">Nouveaux visuels à valider ({items.length})</h2>
            </div>
            <p className="text-sm text-gray-400 mb-4">
                Campagnes déjà en diffusion dont l'annonceur propose un nouveau visuel. Le visuel actuel reste en ligne tant que vous n'avez pas validé.
            </p>
            <div className="space-y-4">
                {items.map(item => (
                    <div key={item._id} className="border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="font-medium text-gray-100 truncate">{item.title}</p>
                            <span className="text-xs text-gray-400 shrink-0">
                                Proposé le {new Date(item.pendingMedia.submittedAt).toLocaleString('fr-FR')}
                            </span>
                        </div>
                        <div className="flex flex-col md:flex-row gap-4">
                            <Creative fileId={item.mediaFileId} type={item.mediaType} label="Visuel actuel" />
                            <Creative fileId={item.pendingMedia.fileId} type={item.pendingMedia.type} label="Nouveau visuel proposé" />
                        </div>
                        {rejectingId === item._id ? (
                            <div className="mt-3 space-y-2">
                                <textarea
                                    value={rejectReason}
                                    onChange={e => setRejectReason(e.target.value)}
                                    placeholder="Motif du refus (envoyé à l'annonceur)"
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm text-gray-100"
                                    rows={2}
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleReject(item)}
                                        disabled={actingOn === item._id}
                                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
                                    >
                                        Confirmer le refus
                                    </button>
                                    <button
                                        onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm"
                                    >
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={() => setConfirmApprove(item)}
                                    disabled={actingOn === item._id}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm disabled:opacity-50"
                                >
                                    Approuver le nouveau visuel
                                </button>
                                <button
                                    onClick={() => { setRejectingId(item._id); setRejectReason(''); }}
                                    disabled={actingOn === item._id}
                                    className="px-4 py-2 bg-red-600/80 hover:bg-red-700 text-white rounded-lg text-sm disabled:opacity-50"
                                >
                                    Refuser
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {confirmApprove && (
                <ConfirmationModal
                    isOpen
                    title="Valider ce nouveau visuel ?"
                    message={`Le nouveau visuel remplacera celui de « ${confirmApprove.title} » sur les statuts WhatsApp des diffuseurs. Confirmez-vous l'avoir vérifié ?`}
                    confirmText="Valider"
                    cancelText="Annuler"
                    variant="success"
                    isLoading={actingOn === confirmApprove._id}
                    onConfirm={() => handleApprove(confirmApprove)}
                    onCancel={() => setConfirmApprove(null)}
                />
            )}
        </div>
    );
};

export default MediaChangeQueue;
