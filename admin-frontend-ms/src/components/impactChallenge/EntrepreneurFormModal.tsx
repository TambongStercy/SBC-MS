import React, { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Upload01Icon } from '@hugeicons/core-free-icons';
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
import { Button, Field, Input, Select, Textarea } from '../ui';
import { cn } from '../../lib/cn';
import { FormSheet, Notice } from './shared';

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
        <FormSheet
            wide
            title={e ? `Modifier ${e.name}` : 'Ajouter un entrepreneur'}
            description="Tous les champs sont demandés par l’app, vidéo comprise."
            onClose={onClose}
            busy={saving || uploading}
            footer={
                <>
                    <Button variant="outline" size="lg" onClick={onClose} disabled={saving || uploading}>Annuler</Button>
                    <Button variant="primary" size="lg" onClick={save} loading={saving} disabled={uploading}>Enregistrer</Button>
                </>
            }
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom complet" required>
                    <Input className="h-11 sm:h-9" value={f.name} onChange={ev => set('name', ev.target.value)} />
                </Field>
                <Field label="Nom du projet" required>
                    <Input className="h-11 sm:h-9" value={f.projectName} onChange={ev => set('projectName', ev.target.value)} />
                </Field>
                <Field label="E-mail" required>
                    <Input type="email" className="h-11 sm:h-9" value={f.email} onChange={ev => set('email', ev.target.value)} />
                </Field>
                <Field label="Téléphone" required>
                    <Input type="tel" className="h-11 sm:h-9" value={f.phoneNumber} onChange={ev => set('phoneNumber', ev.target.value)}
                        placeholder="ex. 237 6XX XX XX XX" />
                </Field>
                <Field label="Pays" required>
                    <Select className="h-11 sm:h-9" value={f.country} onValueChange={v => set('country', v)}
                        options={countries.map(([code, name]) => ({ value: code, label: name }))} />
                </Field>
                <Field label="Ville" required>
                    <Input className="h-11 sm:h-9" value={f.city} onChange={ev => set('city', ev.target.value)} />
                </Field>
            </div>
            <Field label="Secteur d’activité" required>
                <Input className="h-11 sm:h-9" value={f.businessCategory} onChange={ev => set('businessCategory', ev.target.value)}
                    placeholder="Agriculture, couture, transport…" />
            </Field>
            <Field label="Le projet (français)" required>
                <Textarea rows={3} value={f.fr} onChange={ev => set('fr', ev.target.value)} />
            </Field>
            <Field label="Le projet (anglais)" required>
                <Textarea rows={3} value={f.en} onChange={ev => set('en', ev.target.value)} />
            </Field>

            <div className="space-y-2">
                <p className="text-sm font-medium text-fg">Vidéo de présentation ({VIDEO_MAX_SECONDS} s au maximum)<span className="text-danger" aria-hidden="true"> *</span></p>
                {video && (
                    <div>
                        <video src={video.url} controls playsInline preload="metadata"
                            className="max-h-64 w-full rounded-panel border border-line bg-black" />
                        <p className="mt-1 text-xs text-fg-muted">
                            {video.filename}{video.duration !== undefined ? ` · ${video.duration} s` : ''}
                        </p>
                    </div>
                )}
                <label className={cn(
                    'inline-flex h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-fg sm:h-9',
                    uploading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-surface-2',
                )}>
                    <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden="true" />
                    {checkingVideo ? 'Vérification de la durée…' : progress !== null ? `Envoi… ${progress} %` : video ? 'Remplacer la vidéo' : 'Choisir la vidéo'}
                    <input type="file" accept="video/*" className="sr-only" disabled={uploading}
                        onChange={ev => { const file = ev.target.files?.[0]; ev.target.value = ''; if (file) pickVideo(file); }} />
                </label>
                <p className="text-xs text-fg-muted">La durée est vérifiée avant l’envoi. {VIDEO_MAX_MB} Mo au maximum.</p>
            </div>

            <div className="space-y-2">
                <p className="text-sm font-medium text-fg">Compte SBC de l’entrepreneur</p>
                <SbcAccountPicker value={userId} onChange={setUserId} suggestion={f.email.trim() || undefined} />
                <p className="text-xs text-fg-muted">
                    Indispensable pour lui verser ses gains s’il gagne : sa part est créditée sur le solde de ce compte. Sans compte lié, le versement est refusé.
                </p>
            </div>

            {error && <Notice tone="danger">{error}</Notice>}
        </FormSheet>
    );
};

export default EntrepreneurFormModal;
