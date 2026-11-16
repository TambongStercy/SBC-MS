import { useEffect, useState } from "react";
import Header from "../components/common/Header";
import StatCard from "../components/common/statCard";
import { motion } from "framer-motion";
import {
  BadgeSwissFranc,
  UserRound,
  UserRoundCheck,
  ListChecks,
  // Package,
  // CalendarDays,
  // Ticket,
  Landmark,
  ChevronDown,
  Target,
  MessageSquare,
  TrendingUp,
  DollarSign,
  Wallet,
  Users,
} from "lucide-react";
import UsersOverViewCahrt from "../components/charts/usersOverViewCahrt";
import ComparisonChart from "../components/charts/ComparisonChart";
import MonthlyRevenueChart from "../components/charts/MonthlyRevenueChart";
import ActivityOverviewChart from "../components/charts/ActivityOverviewChart";
import RecentTransactionsList from "../components/common/RecentTransactionsList";

import { fetchDashboard, fetchRecentTransactions } from "../api"; // Import the API functions
import { AccountTransaction } from "../services/adminAccountTransactionApi"; // Import the shared AccountTransaction type
import { getRelanceStats, getRecentWithdrawals, RelanceStats, RecentWithdrawal } from "../services/adminDashboardApi";
import RecentWithdrawalsList from "../components/common/RecentWithdrawalsList";
import GatewayBalancesCard from "../components/common/GatewayBalancesCard";

import Loader from "../components/common/loader";
import { getCountryName } from "../utils/countryUtils"; // Import the new helper

// --- Define Interface for Dashboard Data ---
export interface MonthlyRevenueData {
  month: string;      // e.g., "2024-5"
  totalAmount: number;
}

// New interface for monthly aggregated counts
export interface MonthlyCountData {
  month: string; // e.g., "2024-02"
  count: number;
}

// Export the interface so other components can import it
export interface ActivityOverviewData {
  month: string;      // e.g., "2024-5"
  deposits: number;
  withdrawals: number;
  payments: number;
}

interface AdminDashboardData {
  adminBalance: number;
  adminUSDBalance?: number; // USD balance
  count: number;
  classiqueSubCount: number; // Updated: Separate Classique subscription count
  cibleSubCount: number; // Updated: Separate Cible subscription count
  relanceSubCount: number; // Active Relance subscription count
  monthlyAllUsers: MonthlyCountData[];
  monthlyClassiqueSubs: MonthlyCountData[];
  monthlyCibleSubs: MonthlyCountData[];
  monthlyRelanceSubs: MonthlyCountData[];
  totalTransactions: number;
  totalWithdrawals: number;
  totalDeposits: number; // Total deposit transactions
  totalRevenue: number;
  // User Balances - Separated by currency
  totalUserBalanceXAF: number; // Sum of all users' XAF balances
  totalUserBalanceUSD: number; // Sum of all users' USD balances
  totalUserActivationBalance: number; // Sum of all users' activation balances
  totalCountryBalances: number; // Sum of all user XAF balances across countries
  monthlyRevenue: MonthlyRevenueData[];
  balancesByCountry: { [countryCode: string]: number };
  activityOverview: ActivityOverviewData[];
}
// --- End Interface ---

// Helper function to get a consistent color based on country code
// Basic hash function for demonstration - might need a better one for more countries
const getColorForCountry = (countryCode: string) => {
  const colors = [
    "#22c55e", // green-500
    "#eab308", // yellow-500
    "#f97316", // orange-500
    "#84cc16", // lime-500
    "#ef4444", // red-500
    "#3b82f6", // blue-500
    "#a855f7", // purple-500
    "#d946ef", // fuchsia-500
    "#14b8a6", // teal-500
  ];
  let hash = 0;
  for (let i = 0; i < countryCode.length; i++) {
    hash = countryCode.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const OverViewPage = () => {
  // State to store dashboard and users data
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<AccountTransaction[]>([]);
  const [relanceStats, setRelanceStats] = useState<RelanceStats | null>(null);
  const [recentWithdrawals, setRecentWithdrawals] = useState<RecentWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null); // State for selected country

  // Fetch dashboard and users data when the component mounts
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [dashboardResponse, recentTransactionsResponse, relanceStatsData, recentWithdrawalsData] = await Promise.all([
          fetchDashboard(),
          fetchRecentTransactions(5),
          getRelanceStats(),
          getRecentWithdrawals(5)
        ]);

        console.log("Raw Dashboard Response:", dashboardResponse);

        const actualDashboardData = dashboardResponse.data;

        if (!actualDashboardData || typeof actualDashboardData.adminBalance === 'undefined') {
          console.error("Dashboard data seems invalid or missing key properties.", actualDashboardData);
          throw new Error("Received invalid dashboard data structure from API.");
        }

        setDashboardData(actualDashboardData);
        setRecentTransactions(recentTransactionsResponse);
        setRelanceStats(relanceStatsData);
        setRecentWithdrawals(recentWithdrawalsData);

        if (actualDashboardData.balancesByCountry && Object.keys(actualDashboardData.balancesByCountry).length > 0) {
          setSelectedCountryCode(Object.keys(actualDashboardData.balancesByCountry)[0]);
        }

        // Now directly use the pre-aggregated monthly data from the backend
        const formattedUsersData = actualDashboardData.monthlyAllUsers
          .filter((allUserMonth: MonthlyCountData) => allUserMonth.month) // Filter out null/undefined months
          .map((allUserMonth: MonthlyCountData) => {
            const classiqueMonth = actualDashboardData.monthlyClassiqueSubs.find((s: MonthlyCountData) => s.month === allUserMonth.month);
            const cibleMonth = actualDashboardData.monthlyCibleSubs.find((s: MonthlyCountData) => s.month === allUserMonth.month);
            const relanceMonth = actualDashboardData.monthlyRelanceSubs?.find((s: MonthlyCountData) => s.month === allUserMonth.month);

            // Convert month format from "2024-02" to "févr. 24"
            const [year, month] = allUserMonth.month.split('-');
            const monthNames = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
            const monthLabel = `${monthNames[parseInt(month) - 1]} ${year.slice(2)}`;

            return {
              monthLabel: monthLabel, // Chart expects "monthLabel"
              Users: allUserMonth.count, // Chart expects "Users" (capital U)
              Classique: classiqueMonth?.count || 0, // Chart expects "Classique" (capital C)
              Cible: cibleMonth?.count || 0, // Chart expects "Cible" (capital C)
              Relance: relanceMonth?.count || 0, // Chart expects "Relance" (capital R)
            };
          });
        setMonthlyData(formattedUsersData);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Impossible de charger les données");
        setLoading(false);
      }
    };

    loadData();
  }, []); // Empty dependency array ensures it runs once

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader name={"Admin"} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center min-h-[60vh] text-danger">
        {error}
      </div>
    );
  }

  return (
    <div>
      <Header title="Tableau de bord" />

      <main>
        <motion.div
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          {/* CORE STATS */}
          <StatCard
            name="Solde Admin (XAF)"
            icon={BadgeSwissFranc}
            value={dashboardData?.adminBalance != null ? `${Math.round(dashboardData.adminBalance).toLocaleString('fr-FR')} F` : "—"}
            color="#6366f1"
          />
          <StatCard
            name="Solde Admin (USD)"
            icon={DollarSign}
            value={dashboardData?.adminUSDBalance != null ? `$${dashboardData.adminUSDBalance.toFixed(2)}` : "$0.00"}
            color="#10b981"
          />
          <StatCard
            name="Total membres"
            icon={UserRound}
            value={dashboardData?.count || "—"}
            color="#ec4899"
          />
          <StatCard
            name="Abonnés Classique"
            icon={UserRoundCheck}
            value={dashboardData?.classiqueSubCount || "—"}
            color="#f59e0b"
          />
          <StatCard
            name="Abonnés Cible"
            icon={UserRoundCheck}
            value={dashboardData?.cibleSubCount || "—"}
            color="#8b5cf6"
          />
          <StatCard
            name="Abonnés Relance"
            icon={UserRoundCheck}
            value={dashboardData?.relanceSubCount || "—"}
            color="#ef4444"
          />

          {/* USER BALANCES SECTION */}
          <StatCard
            name="Soldes membres (XAF)"
            icon={Wallet}
            value={dashboardData?.totalUserBalanceXAF != null ? `${Math.round(dashboardData.totalUserBalanceXAF).toLocaleString('fr-FR')} F` : "—"}
            color="#3b82f6"
          />
          <StatCard
            name="Soldes membres (USD)"
            icon={DollarSign}
            value={dashboardData?.totalUserBalanceUSD != null ? `$${dashboardData.totalUserBalanceUSD.toFixed(2)}` : "$0.00"}
            color="#059669"
          />
          <StatCard
            name="Soldes d'activation"
            icon={Users}
            value={dashboardData?.totalUserActivationBalance != null ? `${Math.round(dashboardData.totalUserActivationBalance).toLocaleString('fr-FR')} F` : "—"}
            color="#7c3aed"
          />

          {/* TRANSACTION STATS */}
          <StatCard
            name="Revenu total"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalRevenue != null ? `${Math.round(dashboardData.totalRevenue).toLocaleString('fr-FR')} F` : "—"}
            color="#14b8a6"
          />
          <StatCard
            name="Total retraits"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalWithdrawals != null ? `${Math.round(dashboardData.totalWithdrawals).toLocaleString('fr-FR')} F` : "—"}
            color="#ef4444"
          />
          <StatCard
            name="Total transactions"
            icon={ListChecks}
            value={dashboardData?.totalTransactions || "—"}
            color="#10b981"
          />
          <StatCard
            name="Total dépôts"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalDeposits != null ? `${Math.round(dashboardData.totalDeposits).toLocaleString('fr-FR')} F` : "—"}
            color="#16a34a"
          />

          {/* RELANCE STATS */}
          {relanceStats && (
            <>
              <StatCard
                name="Campagnes actives"
                icon={Target}
                value={relanceStats.activeCampaigns || 0}
                color="#a855f7"
              />
              <StatCard
                name="Messages envoyés"
                icon={MessageSquare}
                value={relanceStats.totalMessagesSent || 0}
                color="#06b6d4"
              />
              <StatCard
                name="Taux de livraison"
                icon={TrendingUp}
                value={`${(relanceStats.averageDeliveryRate || 0).toFixed(1)}%`}
                color="#f59e0b"
              />
            </>
          )}

          {/* DYNAMIC COUNTRY BALANCE DISPLAY */}
          {dashboardData?.balancesByCountry && Object.keys(dashboardData.balancesByCountry).length > 0 && (
            <div className="bg-surface border border-line p-4 rounded-lg flex flex-col justify-between col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-2 xl:col-span-4"> {/* Updated: Container spans remaining width */}
              {/* Country Selection Dropdown */}
              <div className="relative">
                <select
                  value={selectedCountryCode || ''}
                  onChange={(e) => setSelectedCountryCode(e.target.value)}
                  className="block w-full appearance-none bg-surface border border-line-strong text-fg py-2 px-3 pr-8 rounded-sm leading-tight focus:outline-hidden focus:bg-surface focus:border-fg-subtle text-sm mb-2" // Added text-sm and mb-2
                >
                  {Object.keys(dashboardData.balancesByCountry).map((countryCode) => (
                    <option key={countryCode} value={countryCode}>
                      {getCountryName(countryCode)}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-fg-muted">
                  <ChevronDown size={18} />
                </div>
              </div>

              {/* Selected Country Balance Card */}
              {selectedCountryCode && (
                <StatCard
                  key={selectedCountryCode} // Ensure re-render on change
                  name={`Solde ${getCountryName(selectedCountryCode)}`}
                  icon={Landmark}
                  value={dashboardData.balancesByCountry[selectedCountryCode] != null ? `${Math.round(dashboardData.balancesByCountry[selectedCountryCode]).toLocaleString('fr-FR')} F` : "—"}
                  color={getColorForCountry(selectedCountryCode)}
                />
              )}
            </div>
          )}
        </motion.div>

        {/* GATEWAY BALANCES SECTION */}
        <div className="mb-8">
          <GatewayBalancesCard
            totalUserBalanceXAF={dashboardData?.totalUserBalanceXAF || 0}
            totalUserBalanceUSD={dashboardData?.totalUserBalanceUSD || 0}
          />
        </div>

        {/* CHARTS & LISTS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
            <UsersOverViewCahrt data={monthlyData} />

            {/* Monthly Revenue Chart */}
            <div className="bg-surface border border-line p-6 rounded-lg md:col-span-1">
              <h3 className="text-lg font-semibold mb-4 text-fg">
                Revenu mensuel
              </h3>
              <MonthlyRevenueChart data={dashboardData?.monthlyRevenue || []} />
            </div>

            {/* Activity Overview Chart */}
            <div className="bg-surface border border-line p-6 rounded-lg md:col-span-1">
              <h3 className="text-lg font-semibold mb-4 text-fg">
                Activité mensuelle
              </h3>
              <ActivityOverviewChart data={dashboardData?.activityOverview || []} />
            </div>
          </div>

          {/* Right Sidebar Area (Comparison Charts + Recent Transactions) */}
          <div className="flex flex-col gap-8">
            {/* Comparison Charts */}
            {dashboardData && (
              <>
                <div className="bg-surface border border-line p-4 rounded-lg h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Membres et abonnés"
                    data={[
                      { name: "Autres membres", value: dashboardData.count - (dashboardData.classiqueSubCount + dashboardData.cibleSubCount + (dashboardData.relanceSubCount || 0)) },
                      { name: "Abonnés Classique", value: dashboardData.classiqueSubCount },
                      { name: "Abonnés Cible", value: dashboardData.cibleSubCount },
                      { name: "Abonnés Relance", value: dashboardData.relanceSubCount || 0 },
                    ]}
                    colors={['#6b7280', '#f59e0b', '#8b5cf6', '#ef4444']} // gray, amber, purple, red
                  />
                </div>

                <div className="bg-surface border border-line p-4 rounded-lg h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Revenu et retraits"
                    data={[
                      { name: "Revenu total", value: dashboardData.totalRevenue },
                      { name: "Retraits totaux", value: dashboardData.totalWithdrawals },
                    ]}
                    colors={['#14b8a6', '#ef4444']} // teal, red
                  />
                </div>

                <div className="bg-surface border border-line p-4 rounded-lg h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Transactions et membres"
                    data={[
                      { name: "Transactions", value: dashboardData.totalTransactions },
                      { name: "Membres", value: dashboardData.count },
                    ]}
                    colors={['#10b981', '#ec4899']} // emerald, pink
                  />
                </div>
              </>
            )}

            {/* Recent Transactions List */}
            <div className="bg-surface border border-line p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-fg">
                Transactions récentes
              </h3>
              <RecentTransactionsList transactions={recentTransactions} />
            </div>

            {/* Recent Withdrawals List */}
            <div className="bg-surface border border-line p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-fg">
                Retraits récents
              </h3>
              <RecentWithdrawalsList withdrawals={recentWithdrawals} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default OverViewPage;
