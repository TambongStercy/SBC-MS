import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon, ShieldUserIcon } from '@hugeicons/core-free-icons';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Button, EmptyState, PageHeader, Pagination, Panel, Skeleton } from '../components/ui';
import { ConfirmDialog, ErrorState, Notice, TodoPanel, count, type ConfirmOptions } from '../components/moduleKit';
import { apiErrorMessage, approveAdsCampaign, rejectAdsCampaign, type AdsCampaign } from '../api/adsNetwork';
import { countryOnly, fetchAdsCampaigns, fetchMediaChanges } from '../components/adsNetwork/api';
import { CampaignReviewCard } from '../components/adsNetwork/CampaignReviewCard';
import MediaChangeQueue from '../components/adsNetwork/MediaChangeQueue';

const PAGE_SIZE = 10;

/**
 * Moderation queue for SBC Ads Network: paid campaigns waiting for approval
 * (oldest first: an annonceur in this queue is waiting) and new creatives for
 * live campaigns. The list follows the country + period filters (period = when
 * the campaign was created); the "À traiter" counts follow the country only.
 */
export default function AdsNetworkReviewPage() {
  const filters = usePageFilters();
  const qc = useQueryClient();
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const queueScope = countryOnly(filters.apiParams);

  useEffect(() => { setPage(1); }, [filters.apiParams]);

  const list = useQuery({
    queryKey: ['ads', 'review', page, filters.apiParams],
    queryFn: () => fetchAdsCampaigns({ page, limit: PAGE_SIZE }, filters.apiParams),
    placeholderData: prev => prev,
  });
  const pendingAll = useQuery({ queryKey: ['ads', 'queue', 'campaigns', queueScope], queryFn: () => fetchAdsCampaigns({ page: 1, limit: 1 }, queueScope) });
  const mediaAll = useQuery({ queryKey: ['ads', 'queue', 'media', queueScope], queryFn: () => fetchMediaChanges(queueScope) });

  // Arriving from the dashboard's "Comparer" link: bring the creatives into view.
  useEffect(() => {
    if (location.hash === '#visuels' && mediaAll.data?.length) {
      requestAnimationFrame(() => document.getElementById('visuels')?.scrollIntoView({ block: 'start' }));
    }
  }, [location.hash, mediaAll.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['ads'] });

  const askApprove = (c: AdsCampaign) => setConfirm({
    title: 'Approuver cette campagne ?',
    description: `« ${c.title} » sera diffusée sur le statut WhatsApp personnel des diffuseurs. Confirmez avoir vérifié la créative, la légende et le contact.`,
    confirmLabel: 'Approuver',
    tone: 'primary',
    onConfirm: async () => {
      try {
        await approveAdsCampaign(c._id);
        toast.success(`« ${c.title} » validée.`);
        void refresh();
      } catch (e) { throw new Error(apiErrorMessage(e, 'La validation a échoué.')); }
    },
  });

  const askReject = (c: AdsCampaign) => setConfirm({
    title: `Refuser « ${c.title} » ?`,
    description: 'Le motif est envoyé tel quel à l’annonceur : c’est la seule information dont il dispose pour corriger.',
    confirmLabel: 'Refuser la campagne',
    reason: { label: 'Motif du refus', required: true, minLength: 3, placeholder: 'Soyez précis sur ce qu’il doit corriger.' },
    onConfirm: async (reason: string) => {
      try {
        await rejectAdsCampaign(c._id, reason);
        toast.success(`« ${c.title} » refusée. Le motif a été envoyé à l’annonceur.`);
        void refresh();
      } catch (e) { throw new Error(apiErrorMessage(e, 'Le refus a échoué.')); }
    },
  });

  const campaigns = list.data?.campaigns ?? [];
  const total = list.data?.pagination.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
       
        title="Validation des campagnes"
        description="Une campagne approuvée part sur le statut WhatsApp personnel de centaines de diffuseurs, sous leur nom. Vérifiez la créative, la légende et le contact ; un refus demande un motif."
        actions={(
          <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => void refresh()} loading={list.isFetching}>
            {!list.isFetching && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
        )}
      />

      <TodoPanel
        loading={pendingAll.isLoading || mediaAll.isLoading}
        items={[
          { key: 'c', label: 'Campagnes payées à valider', hint: 'La plus ancienne en premier : l’annonceur attend.', count: pendingAll.data?.pagination.total ?? 0 },
          { key: 'm', label: 'Nouveaux visuels à valider', hint: 'Le visuel actuel reste en ligne en attendant.', count: mediaAll.data?.length ?? 0 },
        ]}
      />

      <PageFilters filters={filters} />

      <MediaChangeQueue filters={filters.apiParams} />

      <section className="space-y-4" aria-labelledby="queue-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="queue-title" className="text-sm font-semibold text-fg">Campagnes à valider</h2>
          {list.data && <span className="text-sm text-fg-muted">{count(total, 'campagne')}{filters.isFiltered ? ' pour ces filtres' : ''}</span>}
        </div>

        {filters.period !== 'all' && (
          <Notice tone="info">La liste ne montre que les campagnes créées sur la période choisie. Le compte « À traiter » ci-dessus les compte toutes.</Notice>
        )}

        {list.isLoading ? (
          <div className="space-y-4">{[0, 1].map(i => <Skeleton key={i} className="h-80 w-full rounded-panel" />)}</div>
        ) : list.isError ? (
          <Panel><ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /></Panel>
        ) : campaigns.length === 0 ? (
          <Panel>
            <EmptyState
              icon={ShieldUserIcon}
              title={filters.isFiltered ? 'Aucune campagne à valider pour ces filtres' : 'Aucune campagne en attente'}
              description="Les campagnes payées par les annonceurs apparaissent ici, la plus ancienne en premier."
              action={filters.isFiltered ? <Button size="lg" onClick={filters.reset}>Effacer les filtres</Button> : undefined}
            />
          </Panel>
        ) : (
          <div className={list.isFetching ? 'space-y-4 opacity-60' : 'space-y-4'}>
            {campaigns.map(c => <CampaignReviewCard key={c._id} c={c} onApprove={() => askApprove(c)} onReject={() => askReject(c)} />)}
            {(list.data?.pagination.pages ?? 1) > 1 && (
              <Panel>
                <Pagination page={page} totalPages={list.data?.pagination.pages ?? 1} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} className="border-t-0" />
              </Panel>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
