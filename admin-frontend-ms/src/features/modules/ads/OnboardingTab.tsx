import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Upload } from 'lucide-react';
import { getTestCampaign, retireTestCampaign, saveTestCampaign, uploadAdsFile, type TestCampaign } from '../../../api/adsNetwork';
import { Button, Card, ConfirmSheet, Input, SectionTitle, Skeleton, Stat, Textarea, notify } from '../../../ui';
import { formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { fileUrl } from './shared';

const MAX_MB = 100;
type Form = { title: string; description: string; suggestedCaption: string; mediaFileId: string; mediaType: 'image' | 'video'; landingVideoFileId: string; contactWhatsapp: string; contactPhone: string; websiteUrl: string };
const empty: Form = { title: '', description: '', suggestedCaption: '', mediaFileId: '', mediaType: 'image', landingVideoFileId: '', contactWhatsapp: '', contactPhone: '', websiteUrl: '' };
const fromCampaign = (c: TestCampaign | null): Form => c ? {
    title: c.title ?? '', description: c.description ?? '', suggestedCaption: c.suggestedCaption ?? '', mediaFileId: c.mediaFileId ?? '', mediaType: c.mediaType ?? 'image',
    landingVideoFileId: c.landingVideoFileId ?? '', contactWhatsapp: c.contactWhatsapp ?? '', contactPhone: c.contactPhone ?? '', websiteUrl: c.websiteUrl ?? '',
} : empty;

/**
 * The welcome campaign: SBC's own, the first one every new diffuseur posts. It
 * measures their real audience before they get work an annonceur paid for. It
 * goes live without payment or review — the admin editing it is the reviewer.
 */
export function OnboardingTab() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['ads', 'onboarding'], queryFn: getTestCampaign });
    const [form, setForm] = useState<Form>(empty);
    const [uploading, setUploading] = useState<{ kind: 'media' | 'video'; pct: number } | null>(null);
    const [confirm, setConfirm] = useState<'save' | 'retire' | null>(null);
    const [conflict, setConflict] = useState<string | null>(null);
    useEffect(() => { setForm(fromCampaign(q.data ?? null)); }, [q.data]);
    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
    const valid = !!form.title.trim() && !!form.mediaFileId;
    const exists = !!q.data;

    const save = async (force = false, payload: Form = form) => {
        try {
            const saved = await saveTestCampaign(force ? { ...payload, force: true } : payload);
            const offered = (saved as TestCampaign & { offeredNow?: number }).offeredNow ?? 0;
            notify.success(offered > 0 ? `Campagne d’accueil enregistrée — proposée à ${offered} diffuseur(s) en attente.` : 'Campagne d’accueil enregistrée.');
            qc.invalidateQueries({ queryKey: ['ads', 'onboarding'] });
        } catch (e) {
            const status = (e as { response?: { status?: number } })?.response?.status;
            // Changing the creative while diffuseurs are posting it is refused unless forced.
            if (status === 409 && !force) { setConflict(errorMessage(e, 'Des diffuseurs publient actuellement cette campagne.')); return; }
            throw e;
        }
    };

    const upload = async (kind: 'media' | 'video', file: File) => {
        if (file.size / 1048576 > MAX_MB) { notify.error(`Fichier trop lourd (${Math.round(file.size / 1048576)} Mo, maximum ${MAX_MB}). Compresse la vidéo en 720p.`); return; }
        setUploading({ kind, pct: 0 });
        try {
            const id = await uploadAdsFile(file, pct => setUploading({ kind, pct }));
            const next = kind === 'media' ? { ...form, mediaFileId: id, mediaType: (file.type.startsWith('video') ? 'video' : 'image') as Form['mediaType'] } : { ...form, landingVideoFileId: id };
            setForm(next);
            notify.success('Fichier envoyé : enregistre pour le mettre en ligne.');
        } catch (e) { notify.error(errorMessage(e, 'L’envoi a échoué.')); } finally { setUploading(null); }
    };

    if (q.isLoading) return <Skeleton className="h-96 rounded-card" />;
    return (
        <div className="space-y-4 max-w-2xl">
            <Card className="text-sm text-ink-2 space-y-1">
                <p className="font-semibold text-ink">À quoi elle sert</p>
                <p>Un nouveau diffuseur annonce lui-même son nombre de vues. La campagne d’accueil est la première qu’il publie : elle mesure son audience réelle. Tant qu’elle existe, un diffuseur qui ne l’a pas terminée ne reçoit aucune campagne payante. Elle ne coûte rien et ne rapporte rien.</p>
            </Card>
            {q.data?.stats && (
                <div className="grid grid-cols-3 gap-2">
                    <Stat label="Proposée à" value={formatNumber(q.data.stats.offered)} />
                    <Stat label="En cours" value={formatNumber(q.data.stats.inProgress)} />
                    <Stat label="Mesurés" value={formatNumber(q.data.stats.measured)} />
                </div>
            )}
            <Card className="space-y-4">
                <SectionTitle>Créative publiée par les diffuseurs</SectionTitle>
                {form.mediaFileId && (form.mediaType === 'video'
                    ? <video src={fileUrl(form.mediaFileId)} controls playsInline className="w-full max-h-80 rounded-tile bg-black" />
                    : <img src={fileUrl(form.mediaFileId)} alt="Créative" className="w-full max-h-80 object-contain rounded-tile bg-surface-2" />)}
                <label className="inline-flex">
                    <input type="file" accept="image/*,video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload('media', f); e.target.value = ''; }} />
                    <span className="inline-flex items-center gap-2 h-11 px-4 rounded-pill border border-border bg-surface font-semibold text-sm cursor-pointer hover:bg-surface-2">
                        <Upload size={16} />{uploading?.kind === 'media' ? `Envoi… ${uploading.pct} %` : form.mediaFileId ? 'Remplacer' : 'Choisir un fichier'}
                    </span>
                </label>
                <Input label="Titre" value={form.title} onChange={set('title')} />
                <Textarea label="Description" rows={3} value={form.description} onChange={set('description')} />
                <Textarea label="Légende proposée aux diffuseurs" rows={3} value={form.suggestedCaption} onChange={set('suggestedCaption')} hint="Le lien de suivi de chaque diffuseur y est ajouté automatiquement." />
            </Card>
            <Card className="space-y-4">
                <SectionTitle>Page que voient les prospects</SectionTitle>
                <p className="text-sm text-ink-2">Vidéo affichée au-dessus du bouton « Je m’inscris ». Maximum {MAX_MB} Mo : 1 à 2 minutes en 720p.</p>
                {form.landingVideoFileId && <video src={fileUrl(form.landingVideoFileId)} controls playsInline className="w-full max-h-72 rounded-tile bg-black" />}
                <label className="inline-flex">
                    <input type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload('video', f); e.target.value = ''; }} />
                    <span className="inline-flex items-center gap-2 h-11 px-4 rounded-pill border border-border bg-surface font-semibold text-sm cursor-pointer hover:bg-surface-2">
                        <Upload size={16} />{uploading?.kind === 'video' ? `Envoi… ${uploading.pct} %` : form.landingVideoFileId ? 'Remplacer la vidéo' : 'Choisir une vidéo'}
                    </span>
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                    <Input label="WhatsApp" value={form.contactWhatsapp} onChange={set('contactWhatsapp')} inputMode="tel" />
                    <Input label="Téléphone" value={form.contactPhone} onChange={set('contactPhone')} inputMode="tel" />
                    <Input label="Site web" value={form.websiteUrl} onChange={set('websiteUrl')} type="url" />
                </div>
                {q.data?.previewUrl && <a href={q.data.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary font-semibold">Voir la page<ExternalLink size={14} /></a>}
            </Card>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
                {exists ? <Button variant="danger-soft" onClick={() => setConfirm('retire')}>Retirer la campagne d’accueil</Button> : <span />}
                <Button disabled={!valid || !!uploading} onClick={() => setConfirm('save')}>{exists ? 'Enregistrer' : 'Créer et mettre en ligne'}</Button>
            </div>

            <ConfirmSheet open={confirm === 'save'} onClose={() => setConfirm(null)} title={exists ? 'Enregistrer la campagne d’accueil ?' : 'Mettre en ligne la campagne d’accueil ?'}
                message={<p>Elle part en ligne tout de suite pour tous les nouveaux diffuseurs, sans validation.</p>} confirmLabel="Mettre en ligne"
                onConfirm={() => save(false)} />
            <ConfirmSheet open={!!conflict} onClose={() => setConflict(null)} tone="danger" title="Des diffuseurs la publient en ce moment"
                message={<><p>{conflict}</p><p>Forcer la modification change ce qu’ils publient en cours de route.</p></>} confirmLabel="Forcer la modification"
                onConfirm={() => save(true)} />
            <ConfirmSheet open={confirm === 'retire'} onClose={() => setConfirm(null)} tone="danger" title="Retirer la campagne d’accueil ?"
                message={<p>Les nouveaux diffuseurs recevront directement des campagnes payantes, sans mesure préalable de leur audience.</p>} confirmLabel="Retirer"
                onConfirm={async () => { await retireTestCampaign(); notify.success('Campagne d’accueil retirée.'); qc.invalidateQueries({ queryKey: ['ads', 'onboarding'] }); }} />
        </div>
    );
}
