import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, Upload, ExternalLink, RefreshCw } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { useToast } from '../hooks/useToast';
import { getFileUrl } from '../utils/fileUtils';
import {
    TestCampaign,
    apiErrorMessage,
    getTestCampaign,
    retireTestCampaign,
    saveTestCampaign,
    uploadAdsFile,
} from '../api/adsNetwork';

/**
 * Editor for the test campaign — SBC's own campaign, created here rather than
 * bought by an annonceur.
 *
 * It is what measures a new diffuseur's real audience before they are given work
 * someone paid for, so it goes live without payment and without the moderation
 * queue: the admin filling in this form is the reviewer.
 */
const AdsNetworkTestCampaignPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [forcePrompt, setForcePrompt] = useState<string | null>(null);

    const [campaign, setCampaign] = useState<TestCampaign | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<'media' | 'video' | null>(null);
    const [uploadPct, setUploadPct] = useState(0);
    const [confirmRetire, setConfirmRetire] = useState(false);

    const [form, setForm] = useState({
        title: '',
        description: '',
        suggestedCaption: '',
        mediaFileId: '',
        mediaType: 'image' as 'image' | 'video',
        landingVideoFileId: '',
        contactWhatsapp: '',
        contactPhone: '',
        websiteUrl: '',
    });

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const existing = await getTestCampaign();
            setCampaign(existing);
            if (existing) {
                setForm({
                    title: existing.title ?? '',
                    description: existing.description ?? '',
                    suggestedCaption: existing.suggestedCaption ?? '',
                    mediaFileId: existing.mediaFileId ?? '',
                    mediaType: existing.mediaType ?? 'image',
                    landingVideoFileId: existing.landingVideoFileId ?? '',
                    contactWhatsapp: existing.contactWhatsapp ?? '',
                    contactPhone: existing.contactPhone ?? '',
                    websiteUrl: existing.websiteUrl ?? '',
                });
            }
        } catch (err) {
            showError(apiErrorMessage(err, 'Impossible de charger la campagne test'));
        } finally {
            setLoading(false);
        }
        // showError identity is stable enough here; re-running on it would loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { load(); }, [load]);

    // Checked before the request so a 70MB video fails in a second with a
    // readable reason, instead of after a long upload on mobile data.
    const MAX_UPLOAD_MB = 100;

    const upload = async (kind: 'media' | 'video', file: File) => {
        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > MAX_UPLOAD_MB) {
            showError(
                `Fichier trop volumineux (${sizeMb.toFixed(0)} Mo). Maximum ${MAX_UPLOAD_MB} Mo — `
                + 'compressez la vidéo (720p suffit) et réessayez.',
            );
            return;
        }
        setUploading(kind);
        setUploadPct(0);
        try {
            const fileId = await uploadAdsFile(file, setUploadPct);
            setForm(f => kind === 'media'
                ? { ...f, mediaFileId: fileId, mediaType: file.type.startsWith('video') ? 'video' : 'image' }
                : { ...f, landingVideoFileId: fileId });
            showSuccess(kind === 'media' ? 'Créative envoyée.' : 'Vidéo envoyée.');
        } catch (err) {
            showError(apiErrorMessage(err, "L'envoi a échoué."));
        } finally {
            setUploading(null);
        }
    };

    const doSave = async (force: boolean) => {
        setSaving(true);
        try {
            const saved = await saveTestCampaign(force ? { ...form, force: true } : form);
            setCampaign(saved);
            const offered = (saved as TestCampaign & { offeredNow?: number }).offeredNow ?? 0;
            showSuccess(
                offered > 0
                    ? `Campagne test enregistrée et proposée à ${offered} diffuseur(s) en attente.`
                    : 'Campagne test enregistrée.',
            );
            await load();
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 409 && !force) {
                // The backend refuses a creative change while diffuseurs are
                // mid-run — Rufus can override, but through an explicit confirm.
                setForcePrompt(apiErrorMessage(err, 'Des diffuseurs publient actuellement cette campagne.'));
                return;
            }
            showError(apiErrorMessage(err, "L'enregistrement a échoué."));
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        if (!form.title.trim()) return showError('Donnez un titre à la campagne test.');
        if (!form.mediaFileId) return showError('Ajoutez la créative que les diffuseurs publieront.');
        await doSave(false);
    };

    const handleRetire = async () => {
        try {
            await retireTestCampaign();
            showSuccess('Campagne test retirée.');
            setCampaign(null);
            await load();
        } catch (err) {
            showError(apiErrorMessage(err, 'Le retrait a échoué.'));
        } finally {
            setConfirmRetire(false);
        }
    };

    const field = 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent';

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="SBC Ads Network — Campagne test" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-6 grid lg:grid-cols-3 gap-5 items-start"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="lg:col-span-2 bg-blue-900/20 border border-blue-700 rounded-lg p-4 text-sm text-blue-100">
                        <p>
                            <strong>À quoi elle sert.</strong> Un nouveau diffuseur déclare lui-même
                            son nombre de vues. La campagne test est la première qu'il publie : elle
                            mesure son audience réelle avant qu'on lui confie une campagne payée par
                            un annonceur.
                        </p>
                        <p className="mt-2">
                            Elle est créée par SBC, ne coûte rien à personne et ne rapporte rien au
                            diffuseur. Tant qu'elle existe, un diffuseur qui ne l'a pas terminée ne
                            reçoit aucune campagne payante.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {campaign?.stats && (
                            <div className="grid grid-cols-3 lg:grid-cols-1 gap-2">
                                {[
                                    { label: 'Proposée à', value: campaign.stats.offered },
                                    { label: 'En cours', value: campaign.stats.inProgress },
                                    { label: 'Diffuseurs mesurés', value: campaign.stats.measured },
                                ].map(s => (
                                    <div key={s.label} className="bg-gray-900/50 rounded-lg px-3 py-2 flex items-baseline justify-between gap-3">
                                        <span className="text-xs text-gray-400">{s.label}</span>
                                        <span className="text-xl font-semibold text-gray-100">{s.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                    <div className="flex items-center gap-3">
                        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm">
                            <RefreshCw className="w-4 h-4" /> Rafraîchir
                        </button>
                        {campaign?.landingPageUrl && (
                            <a href={campaign.landingPageUrl} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200">
                                <ExternalLink className="w-3 h-3" /> Voir la page d'atterrissage
                            </a>
                        )}
                    </div>
                    </div>
                </motion.div>

                {loading ? (
                    <div className="p-12 flex justify-center"><Loader name="Chargement…" /></div>
                ) : (
                    <motion.div
                        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 grid lg:grid-cols-5 gap-x-8 gap-y-5"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        {!campaign && (
                            <div className="lg:col-span-5 flex items-center gap-2 text-amber-200 bg-amber-900/20 border border-amber-700 rounded-lg p-3 text-sm">
                                <FlaskConical className="w-4 h-4 shrink-0" />
                                Aucune campagne test configurée. Les nouveaux diffuseurs reçoivent
                                donc directement des campagnes payantes, sur la base de leurs vues
                                déclarées.
                            </div>
                        )}

                        {/* Text on the left, media on the right: the creative and the
                            video are what an admin actually judges here, and at 160px
                            they were unreadable on the wide screens this panel runs on. */}
                        <div className="lg:col-span-3 space-y-5">
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Titre</label>
                            <input className={field} value={form.title}
                                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                placeholder="ex. Découvrez SBC" />
                        </div>

                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Description</label>
                            <textarea className={field} rows={2} value={form.description}
                                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                placeholder="Texte affiché sur la page d'atterrissage." />
                        </div>

                        </div>

                        <div className="lg:col-span-2 space-y-6">
                        <div>
                            <label className="block text-sm text-gray-300 mb-2">
                                Créative publiée par les diffuseurs
                            </label>
                            {form.mediaFileId && (
                                <a href={getFileUrl(form.mediaFileId)} target="_blank" rel="noreferrer"
                                    title="Ouvrir en taille réelle">
                                    <img src={getFileUrl(form.mediaFileId)} alt="Créative"
                                        className="w-full max-h-[26rem] rounded-xl bg-black object-contain mb-3 border border-gray-700 hover:border-gray-500 transition-colors" />
                                </a>
                            )}
                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm cursor-pointer">
                                <Upload className="w-4 h-4" />
                                {uploading === 'media' ? `Envoi… ${uploadPct}%` : form.mediaFileId ? 'Remplacer' : 'Choisir un fichier'}
                                <input type="file" accept="image/*,video/*" className="hidden"
                                    onChange={e => e.target.files?.[0] && upload('media', e.target.files[0])} />
                            </label>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-300 mb-1">
                                Vidéo de la page d'atterrissage
                            </label>
                            <p className="text-xs text-gray-500 mb-2">
                                Affichée au-dessus du bouton « Je m'inscris » sur la page que voient
                                les prospects. Maximum 100 Mo — une vidéo de 1 à 2 minutes en 720p
                                tient largement dedans.
                            </p>
                            {form.landingVideoFileId && (
                                <video src={getFileUrl(form.landingVideoFileId)} controls
                                    className="w-full max-h-[26rem] rounded-xl bg-black mb-3 border border-gray-700" />
                            )}
                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm cursor-pointer">
                                <Upload className="w-4 h-4" />
                                {uploading === 'video' ? `Envoi… ${uploadPct}%` : form.landingVideoFileId ? 'Remplacer' : 'Choisir une vidéo'}
                                <input type="file" accept="video/*" className="hidden"
                                    onChange={e => e.target.files?.[0] && upload('video', e.target.files[0])} />
                            </label>
                        </div>

                        </div>

                        <div className="lg:col-span-3 space-y-5">
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">
                                Légende proposée aux diffuseurs
                            </label>
                            <textarea className={field} rows={3} value={form.suggestedCaption}
                                onChange={e => setForm(f => ({ ...f, suggestedCaption: e.target.value }))}
                                placeholder="Le lien de suivi de chaque diffuseur y sera ajouté automatiquement." />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <input className={field} value={form.contactWhatsapp}
                                onChange={e => setForm(f => ({ ...f, contactWhatsapp: e.target.value }))}
                                placeholder="WhatsApp" />
                            <input className={field} value={form.contactPhone}
                                onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                                placeholder="Téléphone" />
                            <input className={field} value={form.websiteUrl}
                                onChange={e => setForm(f => ({ ...f, websiteUrl: e.target.value }))}
                                placeholder="Site web" />
                        </div>

                        <div className="flex flex-wrap gap-3 pt-2">
                            <button onClick={handleSave} disabled={saving || Boolean(uploading)}
                                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 text-sm font-medium">
                                {saving ? 'Enregistrement…' : campaign ? 'Enregistrer les modifications' : 'Créer la campagne test'}
                            </button>
                            {campaign && (
                                <button onClick={() => setConfirmRetire(true)}
                                    className="px-4 py-2.5 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm">
                                    Retirer
                                </button>
                            )}
                        </div>
                        </div>
                    </motion.div>
                )}
            </main>

            {confirmRetire && (
                <ConfirmationModal
                    isOpen
                    title="Retirer la campagne test ?"
                    message="Les nouveaux diffuseurs recevront alors directement des campagnes payantes, sur la base de leurs vues déclarées et non mesurées. Les diffuseurs qui la publient actuellement la terminent normalement."
                    confirmText="Retirer"
                    cancelText="Annuler"
                    onConfirm={handleRetire}
                    onCancel={() => setConfirmRetire(false)}
                />
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
            {forcePrompt && (
                <ConfirmationModal
                    isOpen={true}
                    title="Forcer la modification ?"
                    message={`${forcePrompt}\n\nEn forçant, les vérifications en cours de ces diffuseurs pourront signaler un visuel différent (pénalité de confiance possible).`}
                    confirmText="Forcer la modification"
                    cancelText="Annuler"
                    onConfirm={async () => { setForcePrompt(null); await doSave(true); }}
                    onCancel={() => setForcePrompt(null)}
                />
            )}
        </div>
    );
};

export default AdsNetworkTestCampaignPage;
