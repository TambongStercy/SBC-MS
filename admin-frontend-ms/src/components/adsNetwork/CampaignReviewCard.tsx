import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons';
import { Can } from '../Can';
import { Avatar, Badge, Button, Panel } from '../ui';
import { DateText, Money, Notice, StatusBadge, formatNumber } from '../moduleKit';
import { getFileUrl } from '../../utils/fileUtils';
import type { AdsCampaign } from '../../api/adsNetwork';
import { CAMPAIGN_STATUS, targetingSummary } from './labels';

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

/**
 * Whether the targeting can deliver what was bought. Rufus: the admin must see
 * the shortfall BEFORE approving, to ask the annonceur to widen it instead of
 * validating a campaign that will sit at zero. null = estimate failed ("inconnue",
 * never a confident zero).
 */
function Reach({ c }: { c: AdsCampaign }) {
  if (c.reach === null) return <p className="text-sm text-fg-muted">Inconnue : l’estimation a échoué.</p>;
  if (c.reach.matching === 0) {
    return (
      <Notice tone="danger">
        Aucun diffuseur ne correspond à ce ciblage : la campagne ne pourra être proposée à personne.
        Demandez à l’annonceur d’élargir ses critères avant de valider.
      </Notice>
    );
  }
  if (c.reach.sufficient === false) {
    return (
      <Notice tone="warning">
        {formatNumber(c.reach.matching)} diffuseurs, soit environ {formatNumber(c.reach.projectedUniqueViews)} vues :
        insuffisant pour les {formatNumber(c.targetUniqueViews)} vues achetées. Demandez-lui d’élargir le ciblage.
      </Notice>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-sm text-success">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
      {formatNumber(c.reach.matching)} diffuseurs, soit environ {formatNumber(c.reach.projectedUniqueViews)} vues disponibles.
    </p>
  );
}

/**
 * One campaign in the moderation queue. An approved creative goes out on
 * hundreds of personal WhatsApp statuses under the diffuseur's own name, so the
 * creative is shown large, with who is asking and what they bought beside it.
 */
export function CampaignReviewCard({ c, onApprove, onReject }: { c: AdsCampaign; onApprove: () => void; onReject: () => void }) {
  const name = c.advertiser?.name || 'Annonceur inconnu';
  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="space-y-2">
          {c.mediaType === 'video' ? (
            <video src={getFileUrl(c.mediaFileId)} controls preload="metadata" className="max-h-80 w-full sm:max-h-[28rem] rounded-lg bg-black" />
          ) : (
            <img src={getFileUrl(c.mediaFileId)} alt={c.title} className="max-h-80 w-full sm:max-h-[28rem] rounded-lg border border-line bg-surface-2 object-contain" />
          )}
          <Button variant="link" size="sm" asChild>
            <a href={c.previewUrl ?? c.landingPageUrl} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />
              Voir la page d’atterrissage
            </a>
          </Button>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar src={c.advertiser?.avatar ? getFileUrl(c.advertiser.avatar) : null} name={name} size="md" />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-fg">{c.title}</h3>
                <p className="mt-0.5 break-words text-sm text-fg-muted">
                  {[name, c.advertiser?.phoneNumber, c.advertiser?.email].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              <StatusBadge status={c.status} map={CAMPAIGN_STATUS} />
              {c.isFirstCampaign ? (
                <Badge tone="warning"><HugeiconsIcon icon={Alert02Icon} size={12} aria-hidden="true" />Première campagne</Badge>
              ) : (
                <Badge tone="neutral">{formatNumber(c.priorApprovedCampaigns)} déjà validée{c.priorApprovedCampaigns > 1 ? 's' : ''}</Badge>
              )}
            </div>
          </div>

          {c.description && <p className="whitespace-pre-wrap text-sm text-fg-muted">{c.description}</p>}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Budget"><Money value={c.amountPaid} /></Fact>
            <Fact label="Vues uniques achetées">{formatNumber(c.targetUniqueViews)}</Fact>
            <Fact label="Ciblage" wide>{targetingSummary(c)}</Fact>
            <Fact label="Audience disponible" wide><Reach c={c} /></Fact>
            <Fact label="Contact affiché aux prospects" wide>
              {[c.contactWhatsapp && `WhatsApp ${c.contactWhatsapp}`, c.contactPhone && `Tél. ${c.contactPhone}`, c.websiteUrl].filter(Boolean).join(' · ') || '—'}
            </Fact>
            <Fact label="Soumise">{<DateText value={c.submittedForReviewAt ?? c.createdAt} />}</Fact>
          </dl>

          {c.suggestedCaption && (
            <div>
              <p className="mb-1 text-xs text-fg-muted">Légende proposée aux diffuseurs (le lien de suivi y sera ajouté)</p>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg">{c.suggestedCaption}</p>
            </div>
          )}

          <Can module="ads" write>
            <div className="grid grid-cols-1 gap-2 border-t border-line pt-4 sm:flex sm:justify-end">
              <Button variant="danger-ghost" size="lg" className="sm:h-9" onClick={onReject}>Refuser avec un motif</Button>
              <Button variant="primary" size="lg" className="sm:h-9" onClick={onApprove}>
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
                Approuver
              </Button>
            </div>
          </Can>
        </div>
      </div>
    </Panel>
  );
}
