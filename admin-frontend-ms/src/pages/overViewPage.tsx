import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon, Megaphone01Icon, MoneyReceive01Icon, MoneySend01Icon, RefreshIcon, UserGroupIcon, CrownIcon,
} from "@hugeicons/core-free-icons";
import { fetchDashboard, fetchRecentTransactions } from "../api";
import type { AccountTransaction } from "../services/adminAccountTransactionApi";
import { getRelanceStats, getRecentWithdrawals } from "../services/adminDashboardApi";
import { usePageFilters } from "../hooks/usePageFilters";
import { usePermission } from "../hooks/usePermission";
import { countryName } from "../lib/countries";
import { getCountryName } from "../utils/countryUtils";
import PageFilters from "../components/filters/PageFilters";
import { Button, Metric, PageHeader, Panel, PanelBody, PanelHeader, Skeleton } from "../components/ui";
import { ErrorState } from "../components/common/DataStates";
import { formatDelta, formatMoney, formatNumber } from "../components/common/format";
import RecentTransactionsList from "../components/common/RecentTransactionsList";
import RecentWithdrawalsList from "../components/common/RecentWithdrawalsList";
import GatewayBalancesCard from "../components/common/GatewayBalancesCard";
import { AttentionPanel } from "../components/dashboard/AttentionPanel";
import { EvolutionPanel, type ChartSpec, type EvolutionView, type EvolutionWindow } from "../components/dashboard/EvolutionPanel";
import { RankedBars } from "../components/dashboard/RankedBars";
import { addMonths, buildPoints, lastTwoMonths, monthName, monthOf, monthRange, toMonthMap } from "../components/dashboard/months";

// --- Dashboard payload (GET /users/admin/dashboard) ---
export interface MonthlyRevenueData {
  month: string;      // e.g., "2024-5"
  totalAmount: number;
}

export interface MonthlyCountData {
  month: string; // e.g., "2024-02"
  count: number;
}

export interface ActivityOverviewData {
  month: string;      // e.g., "2024-5"
  deposits: number;
  withdrawals: number;
  payments: number;
}

interface AdminDashboardData {
  adminBalance: number;
  adminUSDBalance?: number;
  count: number;
  classiqueSubCount: number;
  cibleSubCount: number;
  relanceSubCount: number;
  monthlyAllUsers: MonthlyCountData[];
  monthlyClassiqueSubs: MonthlyCountData[];
  monthlyCibleSubs: MonthlyCountData[];
  monthlyRelanceSubs: MonthlyCountData[];
  totalTransactions: number;
  totalWithdrawals: number;
  totalDeposits: number;
  totalRevenue: number;
  totalUserBalanceXAF: number;
  totalUserBalanceUSD: number;
  totalUserActivationBalance: number;
  totalCountryBalances: number;
  monthlyRevenue: MonthlyRevenueData[];
  balancesByCountry: { [countryCode: string]: number };
  activityOverview: ActivityOverviewData[];
}

const WINDOWS: EvolutionWindow[] = ['12', '24', 'all'];

/** "Octobre : 1 234 (+12 % vs septembre)" from a month map, or null when there is nothing to compare. */
function monthHint(map: Map<string, number>, fmt: (v: number) => string): string | null {
  const { last, before, lastValue, beforeValue } = lastTwoMonths(map);
  if (!lastValue && !beforeValue) return null;
  const delta = formatDelta(lastValue, beforeValue);
  const lastName = monthName(last).split(' ')[0];
  const beforeName = monthName(before).split(' ')[0].toLowerCase();
  return `${lastName} : ${fmt(lastValue)}${delta ? ` (${delta} vs ${beforeName})` : ''}`;
}

const SmallFigure = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="min-w-0">
    <p className="text-xs text-fg-muted">{label}</p>
    <p className="mt-0.5 text-lg font-semibold tracking-tight text-fg">{value}</p>
    {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
  </div>
);

/**
 * Accueil: what needs someone today (queues), the four numbers that matter,
 * monthly trends (readable, one unit per chart, table view), balances.
 * Everything follows the page's country + period filters, except the queues
 * (country only: an old item still waits).
 */
const OverViewPage = () => {
  const filters = usePageFilters();
  const [params, setParams] = useSearchParams();
  const view: EvolutionView = params.get('vue') === 'tableau' ? 'table' : 'charts';
  const rawWindow = params.get('fenetre');
  const windowValue: EvolutionWindow = WINDOWS.includes(rawWindow as EvolutionWindow) ? (rawWindow as EvolutionWindow) : '12';
  const setParam = (key: string, value: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const canWithdrawals = usePermission('withdrawals') !== 'none';
  const canRelance = usePermission('relance') !== 'none';
  const canFinance = usePermission('finance') !== 'none';
  const { apiParams } = filters;
  const countryOnly = useMemo(() => (filters.country ? { country: filters.country } : {}), [filters.country]);

  const dashboard = useQuery({
    queryKey: ['dashboard', apiParams],
    queryFn: async () => {
      const res = await fetchDashboard(apiParams);
      const data = res?.data as AdminDashboardData | undefined;
      if (!data || typeof data.adminBalance === 'undefined') throw new Error('Réponse du tableau de bord incomplète.');
      return data;
    },
    placeholderData: prev => prev,
  });
  const recentTx = useQuery({
    queryKey: ['dashboard-recent-tx', apiParams],
    queryFn: () => fetchRecentTransactions(6, apiParams) as Promise<AccountTransaction[]>,
    enabled: canFinance,
    placeholderData: prev => prev,
  });
  const pendingWithdrawals = useQuery({
    queryKey: ['dashboard-pending-withdrawals', countryOnly],
    queryFn: () => getRecentWithdrawals(5, countryOnly),
    enabled: canWithdrawals,
  });
  const relance = useQuery({
    queryKey: ['dashboard-relance', apiParams],
    queryFn: () => getRelanceStats(apiParams),
    enabled: canRelance,
  });

  const d = dashboard.data;

  // --- Monthly series ---
  const maps = useMemo(() => ({
    users: toMonthMap(d?.monthlyAllUsers, r => r.count),
    classique: toMonthMap(d?.monthlyClassiqueSubs, r => r.count),
    cible: toMonthMap(d?.monthlyCibleSubs, r => r.count),
    relance: toMonthMap(d?.monthlyRelanceSubs, r => r.count),
    revenue: toMonthMap(d?.monthlyRevenue, r => r.totalAmount),
    deposits: toMonthMap(d?.activityOverview, r => r.deposits),
    withdrawals: toMonthMap(d?.activityOverview, r => r.withdrawals),
    payments: toMonthMap(d?.activityOverview, r => r.payments),
  }), [d]);

  const allTime = filters.period === 'all';
  const { charts, tooShort } = useMemo(() => {
    const now = monthOf(new Date());
    const firstData = [...maps.users.keys(), ...maps.classique.keys(), ...maps.cible.keys()].sort()[0] ?? now;
    let memberKeys: string[];
    let payKeys: string[];
    let payNote: string | undefined;
    if (allTime) {
      const start = windowValue === 'all' ? firstData : addMonths(now, -(Number(windowValue) - 1));
      memberKeys = monthRange(start, now);
      // Without a period the API sends payment figures for the last 12 months only.
      payKeys = monthRange(addMonths(now, -11), now);
      if (windowValue !== '12') payNote = 'Sans période choisie, le serveur ne renvoie que les 12 derniers mois pour cette mesure.';
    } else {
      const from = filters.range.from ? monthOf(filters.range.from) : firstData;
      const toDate = filters.range.to && filters.range.to < new Date() ? filters.range.to : new Date();
      memberKeys = monthRange(from, monthOf(toDate));
      payKeys = memberKeys;
    }
    const subSeries = [
      { key: 'classique', label: 'Classique' },
      { key: 'cible', label: 'Ciblé' },
      ...(memberKeys.some(k => (maps.relance.get(k) ?? 0) > 0) ? [{ key: 'relance', label: 'Relance' }] : []),
    ];
    const specs: ChartSpec[] = [
      {
        id: 'members', title: 'Inscriptions', description: 'Nouveaux membres par mois', unit: 'count',
        series: [{ key: 'users', label: 'Inscriptions' }],
        points: buildPoints(memberKeys, { users: maps.users }),
      },
      {
        id: 'subs', title: 'Nouveaux abonnements', description: 'Abonnements démarrés par mois, par pack', unit: 'count',
        series: subSeries,
        points: buildPoints(memberKeys, { classique: maps.classique, cible: maps.cible, relance: maps.relance }),
      },
      {
        id: 'revenue', title: 'Revenu', description: 'Paiements réussis par mois, en francs', unit: 'money',
        series: [{ key: 'revenue', label: 'Revenu' }],
        points: buildPoints(payKeys, { revenue: maps.revenue }),
        note: payNote,
      },
      {
        id: 'ops', title: 'Opérations réussies', description: 'Nombre d’opérations terminées par mois', unit: 'count',
        series: [{ key: 'deposits', label: 'Dépôts' }, { key: 'withdrawals', label: 'Retraits' }, { key: 'payments', label: 'Paiements' }],
        points: buildPoints(payKeys, { deposits: maps.deposits, withdrawals: maps.withdrawals, payments: maps.payments }),
        note: payNote,
      },
    ];
    return { charts: specs, tooShort: memberKeys.length < 2 };
  }, [maps, allTime, windowValue, filters.range]);

  const countryBars = useMemo(() => Object.entries(d?.balancesByCountry ?? {})
    .map(([code, value]) => ({ key: code, label: getCountryName(code) || code, value: Number(value) || 0 }))
    .filter(i => i.value !== 0), [d]);

  const refresh = () => {
    void dashboard.refetch();
    if (canFinance) void recentTx.refetch();
    if (canWithdrawals) void pendingWithdrawals.refetch();
    if (canRelance) void relance.refetch();
  };

  const periodHint = allTime ? null : 'sur la période';
  const membersHint = allTime ? monthHint(maps.users, v => `${formatNumber(v)} inscrits`) : 'inscrits sur la période';
  const revenueHint = allTime ? monthHint(maps.revenue, formatMoney) : periodHint;
  const subsTotal = d ? d.classiqueSubCount + d.cibleSubCount + (d.relanceSubCount || 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accueil"
        description="Ce qui attend une action, puis les chiffres clés de SBC."
        actions={(
          <Button size="lg" className="w-full sm:w-auto" onClick={refresh} loading={dashboard.isFetching && !dashboard.isLoading}>
            {!(dashboard.isFetching && !dashboard.isLoading) && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
            Actualiser
          </Button>
        )}
      >
        <PageFilters
          filters={filters}
          className="mb-0"
          // One URL update: a second setSearchParams in the same tick would undo the reset.
          onReset={() => setParams(prev => {
            const next = new URLSearchParams(prev);
            ['pays', 'periode', 'du', 'au', 'fenetre'].forEach(k => next.delete(k));
            return next;
          }, { replace: true })}
        />
      </PageHeader>

      {/* 1. À traiter */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={canWithdrawals ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <AttentionPanel country={filters.country || undefined} />
        </div>
        {canWithdrawals && (
          <Panel>
            <PanelHeader title="Derniers retraits en attente" description="Les plus récents, toutes dates confondues." />
            <PanelBody className="pt-0">
              {pendingWithdrawals.isLoading ? (
                <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : pendingWithdrawals.isError ? (
                <ErrorState onRetry={() => void pendingWithdrawals.refetch()} retrying={pendingWithdrawals.isFetching} className="py-6" />
              ) : (
                <RecentWithdrawalsList withdrawals={pendingWithdrawals.data ?? []} />
              )}
            </PanelBody>
          </Panel>
        )}
      </div>

      {/* 2. Key figures */}
      {dashboard.isError && !d ? (
        <Panel>
          <ErrorState
            title="Les chiffres n’ont pas pu être chargés"
            description={dashboard.error instanceof Error ? dashboard.error.message : undefined}
            onRetry={() => void dashboard.refetch()}
            retrying={dashboard.isFetching}
          />
        </Panel>
      ) : (
        <section aria-label="Chiffres clés" className={dashboard.isFetching && d ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={allTime ? 'Membres' : 'Nouveaux membres'}
              icon={UserGroupIcon}
              tone="primary"
              value={d ? formatNumber(d.count) : <Skeleton className="h-8 w-24" />}
              hint={d ? membersHint : undefined}
            />
            <Metric
              label={allTime ? 'Abonnés actifs' : 'Abonnements démarrés, encore actifs'}
              icon={CrownIcon}
              value={d ? formatNumber(subsTotal) : <Skeleton className="h-8 w-24" />}
              hint={d ? `Classique ${formatNumber(d.classiqueSubCount)} · Ciblé ${formatNumber(d.cibleSubCount)}${d.relanceSubCount ? ` · Relance ${formatNumber(d.relanceSubCount)}` : ''}` : undefined}
            />
            <Metric
              label="Revenu (paiements réussis)"
              icon={MoneyReceive01Icon}
              tone="success"
              value={d ? formatMoney(d.totalRevenue) : <Skeleton className="h-8 w-32" />}
              hint={d ? revenueHint : undefined}
            />
            <Metric
              label="Retraits payés"
              icon={MoneySend01Icon}
              value={d ? formatMoney(d.totalWithdrawals) : <Skeleton className="h-8 w-32" />}
              hint={d ? `Dépôts : ${formatMoney(d.totalDeposits)}${periodHint ? ` ${periodHint}` : ''}` : undefined}
            />
          </div>
        </section>
      )}

      {/* 3. Trends */}
      {d ? (
        <EvolutionPanel
          charts={charts}
          view={view}
          onViewChange={v => setParam('vue', v === 'table' ? 'tableau' : null)}
          windowValue={windowValue}
          onWindowChange={w => setParam('fenetre', w === '12' ? null : w === 'all' ? 'all' : w)}
          showWindow={allTime}
          refetching={dashboard.isFetching}
          empty={tooShort ? (
            <p className="rounded-control bg-surface-2 px-4 py-6 text-center text-sm text-fg-muted">
              Les graphiques sont par mois : sur une période de moins de deux mois, ils n’auraient qu’un point.
              Les totaux de la période sont dans les chiffres clés ci-dessus.
            </p>
          ) : undefined}
        />
      ) : !dashboard.isError && (
        <Panel className="p-5"><Skeleton className="h-72 w-full" /></Panel>
      )}

      {/* 4. Balances */}
      {d && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-1">
            <PanelHeader
              title="Soldes"
              description={[
                allTime ? 'Ce que les membres ont sur leur solde' : 'Soldes des membres inscrits sur la période',
                filters.country ? ` (membres de ${countryName(filters.country)})` : '',
                ' ; le compte SBC est global.',
              ].join('')}
            />
            <PanelBody className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <SmallFigure label="Compte SBC" value={formatMoney(d.adminBalance)} hint={d.adminUSDBalance != null ? formatMoney(d.adminUSDBalance, 'USD') : undefined} />
                <SmallFigure label="Soldes des membres" value={formatMoney(d.totalUserBalanceXAF)} hint={formatMoney(d.totalUserBalanceUSD, 'USD')} />
                <SmallFigure label="Soldes d’activation" value={formatMoney(d.totalUserActivationBalance)} />
                <SmallFigure label="Transactions" value={formatNumber(d.totalTransactions)} hint={periodHint ?? 'depuis le début'} />
              </div>
              {countryBars.length > 0 && (
                <div className="border-t border-line pt-4">
                  <p className="mb-3 text-xs font-medium text-fg-muted">Soldes des membres par pays</p>
                  <RankedBars items={countryBars} format={v => formatMoney(v)} ariaLabel="Soldes des membres par pays" />
                </div>
              )}
            </PanelBody>
          </Panel>
          <div className="xl:col-span-2">
            <GatewayBalancesCard
              totalUserBalanceXAF={d.totalUserBalanceXAF || 0}
              totalUserBalanceUSD={d.totalUserBalanceUSD || 0}
              liabilitiesScope={filters.country ? countryName(filters.country) : undefined}
            />
          </div>
        </div>
      )}

      {/* 5. Activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        {canFinance && (
          <Panel className={canRelance ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <PanelHeader
              title="Derniers paiements"
              description="Paiements entrants, du plus récent au plus ancien."
              actions={(
                <Button asChild variant="ghost" size="sm" className="h-11 sm:h-8">
                  <Link to="/transactions">Tout voir <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></Link>
                </Button>
              )}
            />
            <PanelBody className="pt-0">
              {recentTx.isLoading ? (
                <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              ) : recentTx.isError ? (
                <ErrorState onRetry={() => void recentTx.refetch()} retrying={recentTx.isFetching} className="py-6" />
              ) : (
                <RecentTransactionsList transactions={recentTx.data ?? []} />
              )}
            </PanelBody>
          </Panel>
        )}
        {canRelance && (
          <Panel>
            <PanelHeader
              title="Relance"
              description="Messages de relance des filleuls."
              actions={(
                <Button asChild variant="ghost" size="sm" className="h-11 sm:h-8">
                  <Link to="/relance/dashboard">Ouvrir <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></Link>
                </Button>
              )}
            />
            <PanelBody className="pt-0">
              {relance.isLoading ? <Skeleton className="h-20" /> : (
                <div className="grid grid-cols-2 gap-4">
                  <SmallFigure label="Campagnes actives" value={formatNumber(relance.data?.activeCampaigns ?? 0)} />
                  <SmallFigure label="Membres en relance" value={formatNumber(relance.data?.usersInRelance ?? 0)} />
                  <SmallFigure label="Messages envoyés" value={formatNumber(relance.data?.totalMessagesSent ?? 0)} />
                  <SmallFigure
                    label="Taux de livraison"
                    value={`${(relance.data?.averageDeliveryRate ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u202f%`}
                  />
                </div>
              )}
              <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
                <HugeiconsIcon icon={Megaphone01Icon} size={14} aria-hidden="true" />
                Chiffres de la relance des nouveaux filleuls.
              </p>
            </PanelBody>
          </Panel>
        )}
      </div>
    </div>
  );
};

export default OverViewPage;
