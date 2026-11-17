import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { FlaskConicalIcon, LinkSquare02Icon, RefreshIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import { Button, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Skeleton, Textarea } from '../components/ui';
import { ConfirmDialog, ErrorState, Notice, formatNumber, type ConfirmOptions } from '../components/moduleKit';
import { getFileUrl } from '../utils/fileUtils';
import { apiErrorMessage, getTestCampaign, retireTestCampaign, saveTestCampaign, uploadAdsFile, type TestCampaign } from '../api/adsNetwork';

// Checked before the request so a 70 MB video fails in a second with a
// readable reason, instead of after a long upload on mobile data.
const MAX_UPLOAD_MB = 100;

const EMPTY = {
  title: '', description: '', suggestedCaption: '', mediaFileId: '', mediaType: 'image' as 'image' | 'video',
  landingVideoFileId: '', contactWhatsapp: '', contactPhone: '', websiteUrl: '',
};
type Form = typeof EMPTY;

function UploadButton({ label, accept, busy, pct, disabled, onFile }: { label: string; accept: string; busy: boolean; pct: number; disabled?: boolean; onFile: (f: File) => void }) {
  return (
    <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2 sm:h-9 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <HugeiconsIcon icon={Upload01Icon} size={16} aria-hidden="true" />
      {busy ? `Envoi… ${pct} %` : label}
      <input type="file" accept={accept} className="sr-only" disabled={disabled} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className="tabular-nums">{value.length} / {max}</span>;
}

/**
 * Editor for the test campaign: SBC's own campaign, which measures a new
 * diffuseur's real audience before they get paid work. It goes live without
 * payment and without the moderation queue (the admin filling this form is
 * the reviewer). Settings form: no country or period filter.
 */
export default function AdsNetworkTestCampaignPage() {
  const canWrite = usePermission('ads') === 'write';
  const [campaign, setCampaign] = useState<TestCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'media' | 'video' | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<{ title?: string; media?: string }>({});
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const existing = await getTestCampaign();
      setCampaign(existing);
      setLoadError(null);
      if (existing) {
        setForm({
          title: existing.title ?? '', description: existing.description ?? '', suggestedCaption: existing.suggestedCaption ?? '',
          mediaFileId: existing.mediaFileId ?? '', mediaType: existing.mediaType ?? 'image', landingVideoFileId: existing.landingVideoFileId ?? '',
          contactWhatsapp: existing.contactWhatsapp ?? '', contactPhone: existing.contactPhone ?? '', websiteUrl: existing.websiteUrl ?? '',
        });
      }
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doSave = async (force: boolean, payload: Form = form, successMsg?: string) => {
    setSaving(true);
    try {
      const saved = await saveTestCampaign(force ? { ...payload, force: true } : payload);
      setCampaign(saved);
      const offered = (saved as TestCampaign & { offeredNow?: number }).offeredNow ?? 0;
      toast.success(offered > 0
        ? `${successMsg ?? 'Campagne test enregistrée'} : proposée à ${formatNumber(offered)} diffuseur(s) en attente.`
        : (successMsg ?? 'Campagne test enregistrée.'));
      await load();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409 && !force) {
        // The service refuses a creative change while diffuseurs are mid-run; it can be forced, through an explicit confirmation.
        setConfirm({
          title: 'Forcer la modification ?',
          description: apiErrorMessage(err, 'Des diffuseurs publient actuellement cette campagne.'),
          body: <p className="text-sm text-fg-muted">En forçant, les vérifications en cours de ces diffuseurs pourront signaler un visuel différent (pénalité de confiance possible).</p>,
          confirmLabel: 'Forcer la modification',
          onConfirm: () => doSave(true, payload, successMsg),
        });
        return;
      }
      toast.error(apiErrorMessage(err, 'L’enregistrement a échoué.'));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'media' | 'video', file: File) => {
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_UPLOAD_MB) {
      toast.error(`Fichier trop volumineux (${sizeMb.toFixed(0)} Mo). Maximum ${MAX_UPLOAD_MB} Mo : compressez la vidéo (720p suffit) et réessayez.`);
      return;
    }
    setUploading(kind);
    setUploadPct(0);
    try {
      const fileId = await uploadAdsFile(file, setUploadPct);
      const next: Form = kind === 'media'
        ? { ...form, mediaFileId: fileId, mediaType: file.type.startsWith('video') ? 'video' : 'image' }
        : { ...form, landingVideoFileId: fileId };
      setForm(next);
      if (kind === 'media') setErrors(e => ({ ...e, media: undefined }));
      // Uploading only stores the file; an existing, valid campaign is saved at
      // once so "Remplacer" really replaces it.
      if (campaign && next.title.trim() && next.mediaFileId) {
        await doSave(false, next, kind === 'media' ? 'Créative remplacée.' : 'Vidéo remplacée.');
      } else {
        toast.success(kind === 'media' ? 'Créative envoyée : enregistrez la campagne.' : 'Vidéo envoyée : enregistrez la campagne.');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'L’envoi a échoué.'));
    } finally {
      setUploading(null);
    }
  };

  const handleSave = () => {
    const e = {
      title: form.title.trim() ? undefined : 'Donnez un titre à la campagne test.',
      media: form.mediaFileId ? undefined : 'Ajoutez la créative que les diffuseurs publieront.',
    };
    setErrors(e);
    if (e.title || e.media) return;
    void doSave(false);
  };

  const askRetire = () => setConfirm({
    title: 'Retirer la campagne test ?',
    description: 'Les nouveaux diffuseurs recevront alors directement des campagnes payantes, sur la base de leurs vues déclarées et non mesurées. Ceux qui la publient actuellement la terminent normalement.',
    confirmLabel: 'Retirer',
    onConfirm: async () => {
      try {
        await retireTestCampaign();
        toast.success('Campagne test retirée.');
        setCampaign(null);
        await load();
      } catch (e) { throw new Error(apiErrorMessage(e, 'Le retrait a échoué.')); }
    },
  });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  const saveLabel = campaign ? 'Enregistrer les modifications' : 'Créer la campagne test';

  const stat = (label: string, value: ReactNode) => (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-fg">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <PageHeader
       
        title="Campagne test"
        description="La première campagne qu’un nouveau diffuseur publie : elle mesure son audience réelle avant qu’on lui confie une campagne payée. Créée par SBC, elle ne coûte ni ne rapporte rien."
        actions={(
          <>
            {campaign?.landingPageUrl && (
              <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
                <a href={campaign.landingPageUrl} target="_blank" rel="noreferrer">
                  <HugeiconsIcon icon={LinkSquare02Icon} size={16} aria-hidden="true" />Page d’atterrissage
                </a>
              </Button>
            )}
            <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={() => void load()} loading={loading}>
              {!loading && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}Actualiser
            </Button>
            <Can module="ads" write>
              <Button variant="primary" size="lg" className="hidden sm:inline-flex" onClick={handleSave} loading={saving} disabled={!!uploading || loading}>{saveLabel}</Button>
            </Can>
          </>
        )}
      />

      {loading && !campaign && !loadError ? (
        <Skeleton className="h-96 w-full rounded-panel" />
      ) : loadError ? (
        <Panel><ErrorState error={loadError} onRetry={() => void load()} retrying={loading} /></Panel>
      ) : (
        <>
          {campaign?.stats ? (
            <Panel>
              <PanelBody className="pt-4">
                <dl className="grid grid-cols-3 gap-4">
                  {stat('Proposée à', formatNumber(campaign.stats.offered))}
                  {stat('En cours', formatNumber(campaign.stats.inProgress))}
                  {stat('Diffuseurs mesurés', formatNumber(campaign.stats.measured))}
                </dl>
              </PanelBody>
            </Panel>
          ) : !campaign && (
            <Notice tone="warning" icon={FlaskConicalIcon}>
              Aucune campagne test configurée : les nouveaux diffuseurs reçoivent directement des campagnes payantes, sur la base de leurs vues déclarées.
            </Notice>
          )}
          <Notice tone="info">Tant qu’elle existe, un diffuseur qui ne l’a pas terminée ne reçoit aucune campagne payante.</Notice>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Panel className="lg:col-span-3">
              <PanelHeader title="Texte et contact" />
              <PanelBody className="space-y-4">
                <Field label="Titre" required error={errors.title} help={<Counter value={form.title} max={300} />}>
                  <Input value={form.title} maxLength={300} onChange={set('title')} placeholder="ex. Découvrez SBC" className="h-11 sm:h-9" disabled={!canWrite} />
                </Field>
                <Field label="Description" help={<>Texte de la page d’atterrissage · <Counter value={form.description} max={2000} /></>}>
                  <Textarea rows={3} value={form.description} maxLength={2000} onChange={set('description')} disabled={!canWrite} />
                </Field>
                <Field label="Légende proposée aux diffuseurs" help={<>Le lien de suivi de chaque diffuseur y est ajouté · <Counter value={form.suggestedCaption} max={700} /></>}>
                  <Textarea rows={3} value={form.suggestedCaption} maxLength={700} onChange={set('suggestedCaption')} disabled={!canWrite} />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="WhatsApp"><Input value={form.contactWhatsapp} onChange={set('contactWhatsapp')} inputMode="tel" className="h-11 sm:h-9" disabled={!canWrite} /></Field>
                  <Field label="Téléphone"><Input value={form.contactPhone} onChange={set('contactPhone')} inputMode="tel" className="h-11 sm:h-9" disabled={!canWrite} /></Field>
                  <Field label="Site web"><Input value={form.websiteUrl} onChange={set('websiteUrl')} inputMode="url" className="h-11 sm:h-9" disabled={!canWrite} /></Field>
                </div>
              </PanelBody>
            </Panel>

            <Panel className="lg:col-span-2">
              <PanelHeader title="Visuels" />
              <PanelBody className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-fg">Créative publiée par les diffuseurs <span className="text-danger" aria-hidden="true">*</span></p>
                  {form.mediaFileId && (
                    form.mediaType === 'video' ? (
                      <video src={getFileUrl(form.mediaFileId)} controls preload="metadata" className="max-h-96 w-full rounded-lg border border-line bg-black" />
                    ) : (
                      <a href={getFileUrl(form.mediaFileId)} target="_blank" rel="noreferrer" title="Ouvrir en taille réelle">
                        <img src={getFileUrl(form.mediaFileId)} alt="Créative" className="max-h-96 w-full rounded-lg border border-line bg-surface-2 object-contain" />
                      </a>
                    )
                  )}
                  {errors.media && <p className="text-xs text-danger">{errors.media}</p>}
                  <Can module="ads" write>
                    <UploadButton label={form.mediaFileId ? 'Remplacer' : 'Choisir un fichier'} accept="image/*,video/*" busy={uploading === 'media'} pct={uploadPct} disabled={!!uploading} onFile={f => void upload('media', f)} />
                  </Can>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-fg">Vidéo de la page d’atterrissage</p>
                  <p className="text-xs text-fg-muted">Affichée au-dessus du bouton « Je m’inscris ». 100 Mo au plus : 1 à 2 minutes en 720p y tiennent largement.</p>
                  {form.landingVideoFileId && (
                    <video src={getFileUrl(form.landingVideoFileId)} controls preload="metadata" className="max-h-96 w-full rounded-lg border border-line bg-black" />
                  )}
                  <Can module="ads" write>
                    <UploadButton label={form.landingVideoFileId ? 'Remplacer' : 'Choisir une vidéo'} accept="video/*" busy={uploading === 'video'} pct={uploadPct} disabled={!!uploading} onFile={f => void upload('video', f)} />
                  </Can>
                </div>
              </PanelBody>
            </Panel>
          </div>

          <Can module="ads" write>
            {campaign && (
              <Panel className="border-danger/30">
                <PanelHeader
                  title="Retirer la campagne test"
                  description="Les nouveaux diffuseurs recevront directement des campagnes payantes."
                  actions={<Button variant="danger-ghost" size="lg" className="sm:h-9" onClick={askRetire}>Retirer</Button>}
                />
              </Panel>
            )}
            {/* Sticky save on phones: the form is long */}
            <div className="fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface p-3 sm:hidden">
              <Button variant="primary" size="lg" className="w-full" onClick={handleSave} loading={saving} disabled={!!uploading || loading}>{saveLabel}</Button>
            </div>
          </Can>
        </>
      )}

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
