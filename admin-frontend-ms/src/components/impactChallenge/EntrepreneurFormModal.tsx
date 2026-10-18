import React, { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import {
    Entrepreneur,
    EntrepreneurInput,
    VIDEO_MAX_MB,
    VIDEO_MAX_SECONDS,
    addEntrepreneur,
    apiErrorMessage,
    readVideoDuration,
    updateEntrepreneur,
    uploadChallengeVideo,
} from '../../services/impactChallengeApi';
import { countryCodeToNameMap } from '../../utils/countryUtils';
import SbcAccountPicker from './SbcAccountPicker';
import { FormModal, Notice } from './shared';
import { btn, fieldClass, labelClass } from './styles';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type VideoState = { url: string; filename: string; duration?: number; thumbnailUrl?: string };

/**
 * Add an entrepreneur to a challenge, or edit one. Every field the model
 * requires is asked for, the pitch video is checked against the 90-second
 * limit before anything is uploaded, and the member account that will receive
 * the winnings can be linked.
 */
const EntrepreneurFormModal: React.FC<{
    challengeId: string;
    entrepreneur?: Entrepreneur;
    onClose: () => void;
    onSaved: (e: Entrepreneur, isNew: boolean) => void;
}> = ({ challengeId, entrepreneur: e, onClose, onSaved }) => {
    const [f, setF] = useState({
        name: e?.name ?? '',
        email: e?.email ?? '',
        phoneNumber: e?.phoneNumber ?? '',
        country: e?.country ?? 'CM',
        city: e?.city ?? '',
        projectName: e?.projectName ?? '',
        businessCategory: e?.businessCategory ?? '',
        fr: e?.projectDescription?.fr ?? '',
        en: e?.projectDescription?.en ?? '',
    });
    const [userId, setUserId] = useState<string | null>(e?.userId ?? null);
    const [video, setVideo] = useState<VideoState | null>(
        e?.videoUrl ? { url: e.videoUrl, filename: e.videoFilename, duration: e.videoDuration, thumbnailUrl: e.videoThumbnailUrl } : null,
    );
    const [progress, setProgress] = useState<number | null>(null);
    const [checkingVideo, setCheckingVideo] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const set = (key: keyof typeof f, value: string) => {
        setF(prev => ({ ...prev, [key]: value }));
        setError(null);
    };

    const countries = useMemo(() => {
        const entries = Object.entries(countryCodeToNameMap).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
        // Keep a stored value that is not in the list (older records), so editing does not change it.
        if (f.country && !countryCodeToNameMap[f.country]) entries.unshift([f.country, f.country]);
        return entries;
    }, [f.country]);

    const pickVideo = async (file: File) => {
        setError(null);
        if (!file.type.startsWith('video/')) return setError('Choisis un fichier vidéo.');
        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > VIDEO_MAX_MB) {
            return setError(`Vidéo trop lourde (${sizeMb.toFixed(0)} Mo). ${VIDEO_MAX_MB} Mo au maximum : compresse-la (720p suffit) et réessaie.`);
        }
        // The length is read here, before uploading: the service refuses more than 90 s.
        setCheckingVideo(true);
        const duration = await readVideoDuration(file);
        setCheckingVideo(false);
        if (duration === undefined) {
            return setError('Impossible de lire la durée de cette vidéo. Enregistre-la en MP4 et réessaie.');
        }
        if (duration > VIDEO_MAX_SECONDS) {
            return setError(`La vidéo dure ${duration} s : ${VIDEO_MAX_SECONDS} s au maximum. Raccourcis-la et réessaie.`);
        }
        setProgress(0);
        try {
            const uploaded = await uploadChallengeVideo(file, setProgress);
            setVideo({ url: uploaded.url, filename: uploaded.fileName, duration });
        } catch (err) {
            setError(apiErrorMessage(err, 'La vidéo n’a pas pu être envoyée.'));
        } finally {
            setProgress(null);
        }
    };

    const save = async () => {
        const required: Array<[keyof typeof f, string]> = [
            ['name', 'le nom'], ['email', 'l’e-mail'], ['phoneNumber', 'le téléphone'], ['country', 'le pays'], ['city', 'la ville'],
            ['projectName', 'le nom du projet'], ['businessCategory', 'le secteur'], ['fr', 'la description en français'], ['en', 'la description en anglais'],
        ];
        const missing = required.filter(([k]) => !f[k].trim()).map(([, label]) => label);
        if (missing.length) return setError(`Il manque : ${missing.join(', ')}.`);
        if (!EMAIL_RE.test(f.email.trim())) return setError('L’e-mail n’est pas valide.');
        if (!video) return setError('Ajoute la vidéo de présentation.');

        const body: EntrepreneurInput = {
            name: f.name.trim(),
            email: f.email.trim(),
            phoneNumber: f.phoneNumber.trim(),
            country: f.country.trim(),
            city: f.city.trim(),
            projectName: f.projectName.trim(),
            businessCategory: f.businessCategory.trim(),
            projectDescription: { fr: f.fr.trim(), en: f.en.trim() },
            videoUrl: video.url,
            videoFilename: video.filename,
            ...(video.duration !== undefined ? { videoDuration: video.duration } : {}),
            ...(video.thumbnailUrl ? { videoThumbnailUrl: video.thumbnailUrl } : {}),
        };
        setSaving(true);
        setError(null);
        try {
            const saved = e
                // `null` removes a link the admin took off.
                ? await updateEntrepreneur(e._id, { ...body, userId: userId ?? null })
                : await addEntrepreneur(challengeId, userId ? { ...body, userId } : body);
            onSaved(saved, !e);
        } catch (err) {
            setError(apiErrorMessage(err, e ? 'L’entrepreneur n’a pas pu être modifié.' : 'L’entrepreneur n’a pas pu être ajouté.'));
        } finally {
            setSaving(false);
        }
    };

    const uploading = progress !== null || checkingVideo;

    return (
        <FormModal
            wide
            title={e ? `Modifier ${e.name}` : 'Ajouter un entrepreneur'}
            onClose={onClose}
            busy={saving || uploading}
            footer={
                <>
                    <button onClick={onClose} disabled={saving || uploading} className={btn.secondary}>Annuler</button>
                    <button onClick={save} disabled={saving || uploading} className={btn.primary}>
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </>
            }
        >
            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className={labelClass}>Nom complet</label>
                    <input className={fieldClass} value={f.name} onChange={ev => set('name', ev.target.value)} />
                </div>
                <div>
                    <label className={labelClass}>Nom du projet</label>
                    <input className={fieldClass} value={f.projectName} onChange={ev => set('projectName', ev.target.value)} />
                </div>
                <div>
                    <label className={labelClass}>E-mail</label>
                    <input type="email" className={fieldClass} value={f.email} onChange={ev => set('email', ev.target.value)} />
                </div>
                <div>
                    <label className={labelClass}>Téléphone</label>
                    <input type="tel" className={fieldClass} value={f.phoneNumber} onChange={ev => set('phoneNumber', ev.target.value)}
                        placeholder="ex. 237 6XX XX XX XX" />
                </div>
                <div>
                    <label className={labelClass}>Pays</label>
                    <select className={fieldClass} value={f.country} onChange={ev => set('country', ev.target.value)}>
                        {countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                </div>
                <div>
                    <label className={labelClass}>Ville</label>
                    <input className={fieldClass} value={f.city} onChange={ev => set('city', ev.target.value)} />
                </div>
            </div>
            <div>
                <label className={labelClass}>Secteur d’activité</label>
                <input className={fieldClass} value={f.businessCategory} onChange={ev => set('businessCategory', ev.target.value)}
                    placeholder="Agriculture, couture, transport…" />
            </div>
            <div>
                <label className={labelClass}>Le projet (français)</label>
                <textarea className={fieldClass} rows={3} value={f.fr} onChange={ev => set('fr', ev.target.value)} />
            </div>
            <div>
                <label className={labelClass}>Le projet (anglais)</label>
                <textarea className={fieldClass} rows={3} value={f.en} onChange={ev => set('en', ev.target.value)} />
            </div>

            <div>
                <label className={labelClass}>Vidéo de présentation ({VIDEO_MAX_SECONDS} s au maximum)</label>
                {video && (
                    <div className="mb-2">
                        <video src={video.url} controls playsInline preload="metadata"
                            className="w-full max-h-64 rounded-xl bg-black border border-gray-700" />
                        <p className="text-xs text-gray-400 mt-1">
                            {video.filename}{video.duration !== undefined ? ` · ${video.duration} s` : ''}
                        </p>
                    </div>
                )}
                <label className={`inline-flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 rounded-lg text-sm ${uploading ? 'opacity-60 cursor-wait' : 'hover:bg-gray-600 cursor-pointer'}`}>
                    <Upload className="w-4 h-4" />
                    {checkingVideo ? 'Vérification de la durée…' : progress !== null ? `Envoi… ${progress} %` : video ? 'Remplacer la vidéo' : 'Choisir la vidéo'}
                    <input type="file" accept="video/*" className="hidden" disabled={uploading}
                        onChange={ev => { const file = ev.target.files?.[0]; ev.target.value = ''; if (file) pickVideo(file); }} />
                </label>
                <p className="text-xs text-gray-500 mt-1">La durée est vérifiée avant l’envoi. {VIDEO_MAX_MB} Mo au maximum.</p>
            </div>

            <div>
                <label className={labelClass}>Compte SBC de l’entrepreneur</label>
                <SbcAccountPicker value={userId} onChange={setUserId} suggestion={f.email.trim() || undefined} />
                <p className="text-xs text-gray-500 mt-1">
                    Indispensable pour lui verser ses gains s’il gagne : sa part est créditée sur le solde de ce compte. Sans compte lié, le versement est refusé.
                </p>
            </div>

            {error && <Notice tone="danger">{error}</Notice>}
        </FormModal>
    );
};

export default EntrepreneurFormModal;
