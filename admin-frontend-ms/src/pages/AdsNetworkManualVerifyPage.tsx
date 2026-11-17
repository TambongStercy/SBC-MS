import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, LinkSquare02Icon, RefreshIcon, Video01Icon } from '@hugeicons/core-free-icons';
import ReviewVideoPlayer from '../components/common/ReviewVideoPlayer';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Badge, Button, EmptyState, Field, Input, MenuItem, PageHeader, Panel, Skeleton } from '../components/ui';
import { ConfirmDialog, DateText, ErrorState, Notice, RowMenu, TodoPanel, formatNumber, type ConfirmOptions } from '../components/moduleKit';
import { apiErrorMessage, approveManualVerification, rejectManualVerification, type ManualVerification } from '../api/adsNetwork';
import { countryOnly, fetchManualVerifications } from '../components/adsNetwork/api';

/**
 * Video-proof review queue (module adsProofs). Each item is a diffuseur's
 * screen recording: first the code we issued (proves it is fresh), then the
 * views of their WhatsApp status. The reviewer checks the code, reads the view
 * count off the video, then validates (the day is verified and the diffuseur
 * credited) or refuses, optionally banning the diffuseur in the same action.
 * Country = the diffuseur's; period = when the video was received.
 */
export default function AdsNetworkManualVerifyPage() {
  const filters = usePageFilters();
  const qc = useQueryClient();
  const queueScope = countryOnly(filters.apiParams);
  const list = useQuery({
    queryKey: ['ads', 'proofs', filters.apiParams],
    queryFn: () => fetchManualVerifications(filters.apiParams),
    placeholderData: prev => prev,
  });
  const all = useQuery({ queryKey: ['ads', 'queue', 'proofs', queueScope], queryFn: () => fetchManualVerifications(queueScope) });
  const [views, setViews] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ads'] });

  const askApprove = (mv: ManualVerification) => {
    const raw = views[mv.manualVerificationId];
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0) { setMissing(mv.manualVerificationId); return; }
    setMissing(null);
    setConfirm({
      title: 'Valider cette vérification ?',
      description: `Le jour ${mv.day} de ${mv.diffuseurName} sera validé avec ${formatNumber(n)} vues, et le diffuseur crédité. Confirmez que la vidéo montre bien le code ${mv.code} puis les vues du statut.`,
      confirmLabel: 'Valider et créditer',
      tone: 'primary',
      onConfirm: async () => {
        try {
          await approveManualVerification(mv.manualVerificationId, n);
          toast.success(`Jour ${mv.day} validé : ${formatNumber(n)} vues créditées à ${mv.diffuseurName}.`);
          void refresh();
        } catch (e) { throw new Error(apiErrorMessage(e, 'La validation a échoué.')); }
      },
    });
  };

  const askReject = (mv: ManualVerification, ban: boolean) => setConfirm({
    title: ban ? `Refuser et bannir ${mv.diffuseurName} ?` : 'Refuser cette vérification ?',
    description: ban
      ? `La vérification est refusée et ${mv.diffuseurName} ne reçoit plus aucune campagne ; ses offres en attente sont retirées. Son compte SBC reste intact (seul le réseau diffuseur est bloqué) et le bannissement peut être levé.`
      : 'Le motif est visible par le diffuseur, qui peut recommencer.',
    confirmLabel: ban ? 'Refuser et bannir' : 'Refuser',
    reason: { label: ban ? 'Motif (refus et bannissement)' : 'Motif du refus', required: true, minLength: 3, placeholder: 'Ce qui ne va pas dans la vidéo.' },
    onConfirm: async (reason: string) => {
      try {
        await rejectManualVerification(mv.manualVerificationId, reason, ban);
        toast.success(ban ? `Vérification refusée et ${mv.diffuseurName} banni du réseau diffuseur.` : 'Vérification refusée. Le diffuseur peut recommencer.');
        void refresh();
      } catch (e) { throw new Error(apiErrorMessage(e, ban ? 'Le bannissement a échoué.' : 'Le refus a échoué.')); }
    },
  });

  const items = list.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
       
        title="Vérifications vidéo"
        description="Enregistrements d’écran des diffuseurs : vérifiez le code, lisez le nombre de vues, puis validez ou refusez."
        actions={(
          <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => void refresh()} loading={list.isFetching}>
            {!list.isFetching && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
        )}
      />

      <TodoPanel loading={all.isLoading} items={[{ key: 'p', label: 'Preuves vidéo à vérifier', hint: 'Chaque diffuseur attend la validation de son jour pour être crédité.', count: all.data?.length ?? 0 }]} />

      <PageFilters filters={filters} />

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map(i => <Skeleton key={i} className="h-[28rem] w-full rounded-panel" />)}</div>
      ) : list.isError ? (
        <Panel><ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /></Panel>
      ) : items.length === 0 ? (
        <Panel><EmptyState icon={Video01Icon} title={filters.isFiltered ? 'Aucune vidéo pour ces filtres' : 'Aucune vérification vidéo en attente'} description="Les enregistrements envoyés par les diffuseurs apparaissent ici." /></Panel>
      ) : (
        <div className={`grid gap-4 md:grid-cols-2 ${list.isFetching ? 'opacity-60' : ''}`}>
          {items.map(mv => {
            const id = mv.manualVerificationId;
            return (
              <Panel key={id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-fg">{mv.diffuseurName}</p>
                    <p className="text-xs text-fg-muted">
                      {[mv.diffuseurPhone, `Jour ${mv.day}`].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 truncate text-xs text-fg-muted">
                      {mv.isTestCampaign ? <Badge tone="info">Campagne test</Badge> : mv.campaignTitle}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-lg border border-primary/30 bg-primary-soft px-3 py-1.5 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Code attendu</p>
                    <p className="font-mono text-lg font-semibold tracking-widest text-fg">{mv.code}</p>
                  </div>
                </div>

                {mv.videoUrl ? (
                  <div>
                    <ReviewVideoPlayer src={mv.videoUrl} />
                    {/* Phones record screens as .mov/HEVC, which Chrome often cannot decode: always offer a native player. */}
                    <Button variant="link" size="sm" asChild className="mt-1">
                      <a href={mv.videoUrl} target="_blank" rel="noreferrer">
                        <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />
                        La vidéo ne se lance pas ? Ouvrir dans un nouvel onglet
                      </a>
                    </Button>
                  </div>
                ) : (
                  <Notice tone="warning">Vidéo indisponible.</Notice>
                )}

                <p className="text-xs text-fg-muted">
                  Code émis <DateText value={mv.codeIssuedAt} />{mv.uploadedAt && <> · vidéo reçue <DateText value={mv.uploadedAt} /></>}
                </p>

                <Can module="adsProofs" write>
                  <div className="mt-auto space-y-2 border-t border-line pt-3">
                    <Field label="Nombre de vues lu sur la vidéo" error={missing === id ? 'Indiquez le nombre de vues lu sur la vidéo.' : undefined}>
                      <Input
                        type="number" min={0} inputMode="numeric" placeholder="ex. 262" className="h-11"
                        value={views[id] ?? ''}
                        onChange={e => setViews(v => ({ ...v, [id]: e.target.value }))}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="primary" size="lg" className="flex-1" onClick={() => askApprove(mv)}>
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
                        Valider
                      </Button>
                      <Button variant="danger-ghost" size="lg" className="flex-1" onClick={() => askReject(mv, false)}>Refuser</Button>
                      <RowMenu label="Autres actions">
                        {/* Banning belongs here, while looking at the proof: on its own screen it is the step that gets skipped. */}
                        <MenuItem destructive onSelect={() => askReject(mv, true)}>Refuser et bannir ce diffuseur</MenuItem>
                      </RowMenu>
                    </div>
                  </div>
                </Can>
              </Panel>
            );
          })}
        </div>
      )}

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
