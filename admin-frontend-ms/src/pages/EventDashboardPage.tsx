import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon, InformationCircleIcon, Money03Icon, RefreshIcon, Ticket01Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { getEventDashboard, listAdminDisputes } from '../api/event';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { countOpenFraudFlags, countPendingChangeRequests } from '../components/eventAnimation/shared';
import { Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from '../components/ui';
import {
  DetailList, ErrorState, Notice, RankedBars, TodoAction, TodoPanel, formatMoney, formatNumber, formatPercent,
} from '../components/moduleKit';
import { EVENT_STATUS } from '../components/event/shared';

interface Dashboard {
  organizers: { pending: number; approved: number; suspended: number; total: number };
  // pendingReview / rejected: added with event review — absent on older deployments
  events: { draft: number; pendingReview?: number; rejected?: number; published: number; suspended: number; cancelled: number; completed: number; total: number };
  tickets: { issued: number; checkedIn: number; refunded: number; cancelled: number; total: number };
  orders: { paidCount: number; gross: number };
  commissions: { primary: { total: number; count: number }; resale: { total: number; count: number } };
  // added by a later backend version — absent on older deployments
  refunds?: { count: number; amount: number };
  resale: { active: number; sold: number; cancelled: number; volume?: number };
}

/** Each queue is loaded on its own so one failing endpoint never hides the others (an older backend shows nothing). */
const settle = <T,>(p: Promise<T>) => p.then(v => v, () => undefined);

/**
 * SBC Event — tableau de bord: what waits for SBC first (events to validate,
 * organisers to approve, disputes, Animation fraud and change requests), then
 * the four figures that matter (sales, commissions, tickets, events on sale),
 * events by status, and every other count in a details list.
 */
export default function EventDashboardPage() {
  const navigate = useNavigate();
  const filters = usePageFilters();
  /** Queues show everything pending whatever the period: country only. */
  const queueParams = filters.country ? { country: filters.country } : {};
  /** Links keep the chosen country. */
  const go = (path: string) => navigate(filters.country ? `${path}${path.includes('?') ? '&' : '?'}pays=${filters.country}` : path);
  const dash = useQuery({ queryKey: ['event', 'dashboard'], queryFn: () => getEventDashboard() as Promise<Dashboard> });
  const queues = useQuery({
    queryKey: ['event', 'dashboard-queues', queueParams],
    queryFn: async () => {
      const [disputes, fraud, changes] = await Promise.all([
        settle(listAdminDisputes({ status: 'OPEN', limit: 1, ...queueParams }).then(r => r.total)),
        settle(countOpenFraudFlags(queueParams)),
        settle(countPendingChangeRequests(queueParams)),
      ]);
      return { disputes, fraud, changes };
    },
  });
  const d = dash.data;
  const q = queues.data;
  const refresh = () => { void dash.refetch(); void queues.refetch(); };

  const commissions = d ? d.commissions.primary.total + d.commissions.resale.total : 0;
  const checkInRate = d && d.tickets.total ? d.tickets.checkedIn / d.tickets.total : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SBC Event"
        description="La billetterie : ce qui attend une décision de SBC, les ventes et les commissions."
        actions={(
          <Button size="lg" className="w-full sm:w-auto" onClick={refresh} loading={dash.isFetching || queues.isFetching}>
            {!(dash.isFetching || queues.isFetching) && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
        )}
      />

      <PageFilters filters={filters} />
      {filters.isFiltered && (
        <Notice icon={InformationCircleIcon}>
          Le pays s’applique aux litiges et à l’Animation. Les chiffres de la billetterie ci-dessous portent encore sur tout SBC Event :
          ce tableau de bord ne sait pas les filtrer par pays ni par période.
        </Notice>
      )}

      <TodoPanel
        loading={dash.isLoading || queues.isLoading}
        items={[
          {
            key: 'events', label: 'Événements à valider', count: d?.events.pendingReview ?? 0,
            hint: 'Acceptez ou refusez chaque événement avant sa mise en vente.',
            action: <TodoAction onClick={() => go('/event/events?status=PENDING_REVIEW')}>Examiner</TodoAction>,
          },
          {
            key: 'organizers', label: 'Organisateurs à approuver', count: d?.organizers.pending ?? 0,
            action: <TodoAction onClick={() => go('/event/organizers?status=PENDING')}>Voir</TodoAction>,
          },
          {
            key: 'disputes', label: 'Litiges ouverts', count: q?.disputes ?? 0,
            action: <TodoAction onClick={() => go('/event/disputes')}>Traiter</TodoAction>,
          },
          {
            key: 'fraud', label: 'Animation : activités suspectes', count: q?.fraud ?? 0, tone: 'danger',
            hint: 'Un signalement à score élevé empêche de figer le résultat du défi.',
            action: <TodoAction onClick={() => go('/event/animation?tab=a-verifier')}>Vérifier</TodoAction>,
          },
          {
            key: 'changes', label: 'Animation : demandes de modification', count: q?.changes ?? 0,
            action: <TodoAction onClick={() => go('/event/animation?tab=demandes')}>Examiner</TodoAction>,
          },
        ]}
      />

      {dash.isError && !d ? (
        <Panel><ErrorState error={dash.error} onRetry={() => void dash.refetch()} retrying={dash.isFetching} /></Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Ventes de billets" icon={Money03Icon} tone="primary"
              value={d ? formatMoney(d.orders.gross) : <Skeleton className="h-8 w-32" />}
              hint={d ? `${formatNumber(d.orders.paidCount)} commandes payées` : undefined}
              onClick={() => go('/event/orders?status=PAID')}
            />
            <Metric
              label="Commissions SBC" icon={Money03Icon} tone="success"
              value={d ? formatMoney(commissions) : <Skeleton className="h-8 w-32" />}
              hint={d ? `Ventes ${formatMoney(d.commissions.primary.total)} · reventes ${formatMoney(d.commissions.resale.total)}` : undefined}
              onClick={() => go('/event/commissions')}
            />
            <Metric
              label="Billets" icon={Ticket01Icon}
              value={d ? formatNumber(d.tickets.total) : <Skeleton className="h-8 w-24" />}
              hint={d ? `${formatNumber(d.tickets.checkedIn)} entrés${checkInRate != null ? ` (${formatPercent(checkInRate, 0)})` : ''}` : undefined}
              onClick={() => go('/event/tickets')}
            />
            <Metric
              label="Événements en vente" icon={Calendar03Icon}
              value={d ? formatNumber(d.events.published) : <Skeleton className="h-8 w-24" />}
              hint={d ? `sur ${formatNumber(d.events.total)} événements` : undefined}
              onClick={() => go('/event/events?status=PUBLISHED')}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Événements par statut" description="Nombre d’événements dans chaque statut." />
              <PanelBody>
                {!d ? <Skeleton className="h-40 w-full" /> : (
                  <RankedBars
                    items={(['PENDING_REVIEW', 'PUBLISHED', 'DRAFT', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED'] as const)
                      .map(s => ({ key: s, label: EVENT_STATUS[s][0], value: (s === 'PENDING_REVIEW' ? d.events.pendingReview : s === 'REJECTED' ? d.events.rejected : d.events[s.toLowerCase() as 'draft']) ?? 0 }))}
                    emptyText="Aucun événement."
                  />
                )}
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader title="Autres chiffres" description="Organisateurs, reventes et remboursements." />
              <PanelBody>
                {!d ? <Skeleton className="h-40 w-full" /> : (
                  <DetailList items={[
                    [<span key="o" className="inline-flex items-center gap-1.5"><HugeiconsIcon icon={UserGroupIcon} size={14} aria-hidden="true" />Organisateurs</span>,
                      `${formatNumber(d.organizers.total)} (${formatNumber(d.organizers.approved)} approuvés, ${formatNumber(d.organizers.pending)} en attente${d.organizers.suspended ? `, ${formatNumber(d.organizers.suspended)} suspendus` : ''})`],
                    ['Reventes en cours', formatNumber(d.resale.active)],
                    ['Billets revendus', d.resale.volume != null ? `${formatNumber(d.resale.sold)} · ${formatMoney(d.resale.volume)}` : formatNumber(d.resale.sold)],
                    ['Reventes annulées', formatNumber(d.resale.cancelled)],
                    ['Commandes remboursées', d.refunds ? (d.refunds.amount != null ? `${formatNumber(d.refunds.count)} · ${formatMoney(d.refunds.amount)}` : formatNumber(d.refunds.count)) : '—'],
                    ['Billets remboursés', formatNumber(d.tickets.refunded)],
                    ['Billets annulés', formatNumber(d.tickets.cancelled)],
                    ['Règlements de commission', `${formatNumber(d.commissions.primary.count)} ventes · ${formatNumber(d.commissions.resale.count)} reventes`],
                  ]} />
                )}
              </PanelBody>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
