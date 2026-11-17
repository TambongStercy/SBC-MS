import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, ImageUploadIcon } from '@hugeicons/core-free-icons';
import { Can } from '../Can';
import { Badge, Button, Panel, PanelHeader, Skeleton } from '../ui';
import { ConfirmDialog, DateText, ErrorState, type ConfirmOptions } from '../moduleKit';
import { getFileUrl } from '../../utils/fileUtils';
import { apiErrorMessage, approveAdsMediaChange, rejectAdsMediaChange, type AdsMediaChange } from '../../api/adsNetwork';
import { fetchMediaChanges, type AdminFilterParams } from './api';

function Creative({ fileId, type, label, highlight }: { fileId: string; type: 'image' | 'video'; label: string; highlight?: boolean }) {
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="mb-1.5 flex items-center gap-2 text-xs text-fg-muted">
        {label}
        {highlight && <Badge tone="warning">À valider</Badge>}
      </figcaption>
      {type === 'video' ? (
        <video src={getFileUrl(fileId)} controls preload="metadata" className="max-h-72 w-full rounded-lg bg-black" />
      ) : (
        <img src={getFileUrl(fileId)} alt={label} className="max-h-72 w-full rounded-lg border border-line bg-surface-2 object-contain" />
      )}
    </figure>
  );
}

/**
 * New creatives proposed for campaigns already being diffused (CLAUDE.md
 * "replacing a live campaign's creative goes through review"): the live
 * creative keeps running until one is approved, so both are shown side by
 * side. Renders nothing when the queue is empty.
 */
export default function MediaChangeQueue({ filters }: { filters: AdminFilterParams }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['ads', 'media-changes', filters], queryFn: () => fetchMediaChanges(filters) });
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ads'] });

  const approve = useMutation({
    mutationFn: (item: AdsMediaChange) => approveAdsMediaChange(item._id),
    onSuccess: (_, item) => { toast.success(`Nouveau visuel de « ${item.title} » validé. L’annonceur et les diffuseurs en cours sont prévenus.`); void refresh(); },
  });

  const askApprove = (item: AdsMediaChange) => setConfirm({
    title: 'Valider ce nouveau visuel ?',
    description: `Il remplacera celui de « ${item.title} » sur les statuts WhatsApp des diffuseurs. Confirmez l’avoir vérifié.`,
    confirmLabel: 'Valider le visuel',
    tone: 'primary',
    onConfirm: async () => {
      try { await approve.mutateAsync(item); } catch (e) { throw new Error(apiErrorMessage(e, 'La validation a échoué.')); }
    },
  });

  const askReject = (item: AdsMediaChange) => setConfirm({
    title: 'Refuser ce nouveau visuel ?',
    description: `« ${item.title} » garde son visuel actuel. Le motif est envoyé à l’annonceur.`,
    confirmLabel: 'Refuser le visuel',
    reason: { label: 'Motif du refus', required: true, minLength: 3, placeholder: 'Ce que l’annonceur doit corriger.' },
    onConfirm: async (reason: string) => {
      try {
        await rejectAdsMediaChange(item._id, reason);
        toast.success(`Nouveau visuel de « ${item.title} » refusé. L’annonceur garde son visuel actuel.`);
        void refresh();
      } catch (e) { throw new Error(apiErrorMessage(e, 'Le refus a échoué.')); }
    },
  });

  if (query.isLoading) return <Skeleton className="h-40 w-full rounded-panel" />;
  if (query.isError) return <Panel><ErrorState error={query.error} onRetry={() => void query.refetch()} title="Les nouveaux visuels n’ont pas pu être chargés" /></Panel>;
  const items = query.data ?? [];
  if (items.length === 0) return null;

  return (
    <Panel id="visuels" className="scroll-mt-20">
      <PanelHeader
        title={(
          <span className="flex items-center gap-2">
            <HugeiconsIcon icon={ImageUploadIcon} size={18} aria-hidden="true" className="text-primary" />
            Nouveaux visuels à valider ({items.length})
          </span>
        )}
        description="Campagnes déjà en diffusion dont l’annonceur propose un autre visuel. Le visuel actuel reste en ligne tant que le nouveau n’est pas validé."
      />
      <ul className="divide-y divide-line border-t border-line">
        {items.map(item => (
          <li key={item._id} className="space-y-3 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 truncate font-medium text-fg">{item.title}</p>
              <span className="text-xs text-fg-muted">Proposé <DateText value={item.pendingMedia.submittedAt} /></span>
            </div>
            <div className="flex flex-col gap-4 md:flex-row">
              <Creative fileId={item.mediaFileId} type={item.mediaType} label="Visuel actuel" />
              <Creative fileId={item.pendingMedia.fileId} type={item.pendingMedia.type} label="Nouveau visuel proposé" highlight />
            </div>
            <Can module="ads" write>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
                <Button variant="danger-ghost" size="lg" className="sm:h-9" onClick={() => askReject(item)}>Refuser</Button>
                <Button variant="primary" size="lg" className="sm:h-9" onClick={() => askApprove(item)}>
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
                  Valider le nouveau visuel
                </Button>
              </div>
            </Can>
          </li>
        ))}
      </ul>
      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </Panel>
  );
}
