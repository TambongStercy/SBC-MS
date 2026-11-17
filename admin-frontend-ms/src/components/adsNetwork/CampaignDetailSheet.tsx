import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { LinkSquare02Icon, UserMultiple02Icon } from '@hugeicons/core-free-icons';
import { Button, Dialog, EmptyState, ResponsiveList, SheetContent, type ListColumn } from '../ui';
import {
  DateText, DetailList, ErrorState, Money, Notice, SheetSection, StatusBadge, formatDateTime, formatNumber, formatPercent,
} from '../moduleKit';
import { getFileUrl } from '../../utils/fileUtils';
import { getAdsCampaignPerformance, type AdsCampaign, type DiffuseurPerformance } from '../../api/adsNetwork';
import { CAMPAIGN_STATUS, PARTICIPATION_STATUS, targetingSummary } from './labels';

/** Thin progress bar (unique views delivered / bought), one hue. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      {pct > 0 && <div className="h-1.5 rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: 'var(--chart-1)' }} />}
    </div>
  );
}

const diffuseurColumns: ListColumn<DiffuseurPerformance>[] = [
  {
    key: 'who', header: 'Diffuseur', cell: d => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{d.name || d.diffuseurUserId}</p>
        {d.phoneNumber && <p className="text-xs text-fg-muted">{d.phoneNumber}</p>}
      </div>
    ),
  },
  { key: 'status', header: 'Statut', cell: d => <StatusBadge status={d.status} map={PARTICIPATION_STATUS} /> },
  { key: 'views', header: 'Vues (uniques / total)', numeric: true, cell: d => `${formatNumber(d.uniqueViews)} / ${formatNumber(d.totalViews)}` },
  { key: 'clicks', header: 'Clics', numeric: true, cell: d => <>{formatNumber(d.clicks)} <span className="text-xs text-fg-muted">({formatPercent(d.clickThroughRate, 2)})</span></> },
  { key: 'earned', header: 'Gains', numeric: true, cell: d => <><Money value={d.earned} />{d.paidAt && <div className="text-xs text-fg-muted">payé <DateText value={d.paidAt} /></div>}</> },
];

/** A campaign's details and its per-diffuseur performance (read only). */
export function CampaignDetailSheet({ campaign, onOpenChange }: { campaign: AdsCampaign | null; onOpenChange: (open: boolean) => void }) {
  const perf = useQuery({
    queryKey: ['ads', 'performance', campaign?._id],
    queryFn: () => getAdsCampaignPerformance(campaign!._id),
    enabled: !!campaign,
  });
  const c = perf.data?.campaign ?? campaign;

  return (
    <Dialog open={!!campaign} onOpenChange={onOpenChange}>
      {c && (
        <SheetContent
          width="xl"
          title={c.title}
          description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} map={CAMPAIGN_STATUS} />{campaign?.advertiser?.name || 'Annonceur inconnu'}</span>}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                {c.mediaType === 'video' ? (
                  <video src={getFileUrl(c.mediaFileId)} controls preload="metadata" className="max-h-64 w-full rounded-lg bg-black md:max-h-none" />
                ) : (
                  <img src={getFileUrl(c.mediaFileId)} alt={c.title} className="max-h-64 w-full rounded-lg border border-line bg-surface-2 object-contain md:max-h-none" />
                )}
                {(campaign?.previewUrl || campaign?.landingPageUrl) && (
                  <Button variant="link" size="sm" asChild>
                    <a href={campaign.previewUrl ?? campaign.landingPageUrl} target="_blank" rel="noreferrer">
                      <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />Page d’atterrissage
                    </a>
                  </Button>
                )}
              </div>
              <DetailList items={[
                ['Budget', <Money value={c.amountPaid} />],
                ['Vues uniques (facturées)', `${formatNumber(c.progress.uniqueViewsDelivered)} / ${formatNumber(c.progress.targetUniqueViews)} (${c.progress.percentComplete} %)`],
                ['Vues répétées (offertes)', formatNumber(c.progress.repeatViewsDelivered)],
                ['Clics', formatNumber(c.progress.clicksTotal ?? c.clicksTotal)],
                ['Ciblage', targetingSummary(c)],
                campaign?.advertiser && ['Annonceur', [campaign.advertiser.name, campaign.advertiser.phoneNumber, campaign.advertiser.email].filter(Boolean).join(' · ')],
                ['Créée le', formatDateTime(c.createdAt)],
                ['Activée le', formatDateTime(c.activatedAt)],
                ['Terminée le', formatDateTime(c.completedAt)],
              ]} />
            </div>

            {c.rejectionReason && <Notice tone="danger"><strong className="font-medium">Motif du refus :</strong> {c.rejectionReason}</Notice>}

            <SheetSection title="Performance par diffuseur">
              {perf.isError ? (
                <ErrorState error={perf.error} onRetry={() => void perf.refetch()} retrying={perf.isFetching} />
              ) : (
                <div className="overflow-hidden rounded-panel border border-line">
                  <ResponsiveList
                    rows={perf.data?.diffuseurs ?? []}
                    columns={diffuseurColumns}
                    rowKey={d => d.diffuseurUserId}
                    loading={perf.isLoading}
                    loadingRows={3}
                    empty={<EmptyState icon={UserMultiple02Icon} title="Aucun diffuseur pour le moment" description="Personne n’a encore accepté cette campagne." />}
                  />
                </div>
              )}
            </SheetSection>
          </div>
        </SheetContent>
      )}
    </Dialog>
  );
}
