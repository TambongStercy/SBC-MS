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
  monthlyAllUsers: MonthlyCountData[];
  monthlyClassiqueSubs: MonthlyCountData[];
  monthlyCibleSubs: MonthlyCountData[];
  totalTransactions: number;
  totalWithdrawals: number;
  totalDeposits: number; // NEW: Total deposit transactions
  totalRevenue: number;
  totalCountryBalances: number; // NEW: Sum of all user balances across countries
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
        const formattedUsersData = actualDashboardData.monthlyAllUsers.map((allUserMonth: MonthlyCountData) => {
          const classiqueMonth = actualDashboardData.monthlyClassiqueSubs.find((s: MonthlyCountData) => s.month === allUserMonth.month);
          const cibleMonth = actualDashboardData.monthlyCibleSubs.find((s: MonthlyCountData) => s.month === allUserMonth.month);

          // Convert month format from "2024-02" to "Feb 24"
          const [year, month] = allUserMonth.month.split('-');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthLabel = `${monthNames[parseInt(month) - 1]} ${year.slice(2)}`;

          return {
            monthLabel: monthLabel, // Chart expects "monthLabel"
            Users: allUserMonth.count, // Chart expects "Users" (capital U)
            Classique: classiqueMonth?.count || 0, // Chart expects "Classique" (capital C)
            Cible: cibleMonth?.count || 0, // Chart expects "Cible" (capital C)
          };
        });
        setMonthlyData(formattedUsersData);

        setLoading(false);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
        setLoading(false);
      }
    };

    loadData();
  }, []); // Empty dependency array ensures it runs once

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        <Loader name={"Admin"} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen w-screen overflow-auto relative z-10">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 relative z-10">
      <Header title="Tableau de bord" />

      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
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
            value={dashboardData?.adminBalance != null ? `${Math.round(dashboardData.adminBalance).toLocaleString('en-US')} F` : "N/A"}
            color="#6366f1"
          />
          <StatCard
            name="Solde Admin (USD)"
            icon={BadgeSwissFranc}
            value={dashboardData?.adminUSDBalance != null ? `$${dashboardData.adminUSDBalance.toFixed(2)}` : "$0.00"}
            color="#10b981"
          />
          <StatCard
            name="Total Utilisateurs"
            icon={UserRound}
            value={dashboardData?.count || "N/A"}
            color="#ec4899"
          />
          <StatCard
            name="Abonnés Classique"
            icon={UserRoundCheck}
            value={dashboardData?.classiqueSubCount || "N/A"}
            color="#f59e0b"
          />
          <StatCard
            name="Abonnés Cible"
            icon={UserRoundCheck}
            value={dashboardData?.cibleSubCount || "N/A"}
            color="#8b5cf6"
          />
          <StatCard
            name="Revenu Total"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalRevenue != null ? `${Math.round(dashboardData.totalRevenue).toLocaleString('en-US')} F` : "N/A"}
            color="#14b8a6"
          />
          <StatCard
            name="Total Retraits"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalWithdrawals != null ? `${Math.round(dashboardData.totalWithdrawals).toLocaleString('en-US')} F` : "N/A"}
            color="#ef4444"
          />
          <StatCard
            name="Total Transactions"
            icon={ListChecks}
            value={dashboardData?.totalTransactions || "N/A"}
            color="#10b981"
          />
          <StatCard
            name="Total Dépôts"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalDeposits != null ? `${Math.round(dashboardData.totalDeposits).toLocaleString('en-US')} F` : "N/A"}
            color="#16a34a"
          />
          <StatCard
            name="Soldes Totaux"
            icon={BadgeSwissFranc}
            value={dashboardData?.totalCountryBalances != null ? `${Math.round(dashboardData.totalCountryBalances).toLocaleString('en-US')} F` : "N/A"}
            color="#3b82f6"
          />

          {/* RELANCE STATS */}
          {relanceStats && (
            <>
              <StatCard
                name="Campagnes Actives"
                icon={Target}
                value={relanceStats.activeCampaigns || 0}
                color="#a855f7"
              />
              <StatCard
                name="Messages Envoyés"
                icon={MessageSquare}
                value={relanceStats.totalMessagesSent || 0}
                color="#06b6d4"
              />
              <StatCard
                name="Taux de Livraison"
                icon={TrendingUp}
                value={`${(relanceStats.averageDeliveryRate || 0).toFixed(1)}%`}
                color="#f59e0b"
              />
            </>
          )}

          {/* DYNAMIC COUNTRY BALANCE DISPLAY */}
          {dashboardData?.balancesByCountry && Object.keys(dashboardData.balancesByCountry).length > 0 && (
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex flex-col justify-between col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-2 xl:col-span-4"> {/* Updated: Container spans remaining width */}
              {/* Country Selection Dropdown */}
              <div className="relative">
                <select
                  value={selectedCountryCode || ''}
                  onChange={(e) => setSelectedCountryCode(e.target.value)}
                  className="block w-full appearance-none bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 py-2 px-3 pr-8 rounded leading-tight focus:outline-none focus:bg-white dark:focus:bg-gray-600 focus:border-gray-500 dark:focus:border-gray-400 text-sm mb-2" // Added text-sm and mb-2
                >
                  {Object.keys(dashboardData.balancesByCountry).map((countryCode) => (
                    <option key={countryCode} value={countryCode}>
                      {getCountryName(countryCode)}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
                  <ChevronDown size={18} />
                </div>
              </div>

              {/* Selected Country Balance Card */}
              {selectedCountryCode && (
                <StatCard
                  key={selectedCountryCode} // Ensure re-render on change
                  name={`Solde ${getCountryName(selectedCountryCode)}`}
                  icon={Landmark}
                  value={dashboardData.balancesByCountry[selectedCountryCode] != null ? `${Math.round(dashboardData.balancesByCountry[selectedCountryCode]).toLocaleString('en-US')} F` : "N/A"}
                  color={getColorForCountry(selectedCountryCode)}
                />
              )}
            </div>
          )}
        </motion.div>

        {/* CHARTS & LISTS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
            <UsersOverViewCahrt data={monthlyData} />

            {/* Monthly Revenue Chart */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow md:col-span-1">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Revenu Mensuel
              </h3>
              <MonthlyRevenueChart data={dashboardData?.monthlyRevenue || []} />
            </div>

            {/* Activity Overview Chart */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow md:col-span-1">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Aperçu de l'Activité Mensuelle
              </h3>
              <ActivityOverviewChart data={dashboardData?.activityOverview || []} />
            </div>
          </div>

          {/* Right Sidebar Area (Comparison Charts + Recent Transactions) */}
          <div className="flex flex-col gap-8">
            {/* Comparison Charts */}
            {dashboardData && (
              <>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Utilisateurs vs Abonnés"
                    data={[
                      { name: "Autres Utilisateurs", value: dashboardData.count - (dashboardData.classiqueSubCount + dashboardData.cibleSubCount) },
                      { name: "Abonnés Classique", value: dashboardData.classiqueSubCount },
                      { name: "Abonnés Cible", value: dashboardData.cibleSubCount },
                    ]}
                    colors={['#6b7280', '#f59e0b', '#8b5cf6']} // gray, amber, purple
                  />
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Revenu vs Retraits"
                    data={[
                      { name: "Revenu Total", value: dashboardData.totalRevenue },
                      { name: "Retraits Totals", value: dashboardData.totalWithdrawals },
                    ]}
                    colors={['#14b8a6', '#ef4444']} // teal, red
                  />
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow h-64"> {/* Fixed height */}
                  <ComparisonChart
                    title="Transactions vs Utilisateurs"
                    data={[
                      { name: "Transactions", value: dashboardData.totalTransactions },
                      { name: "Utilisateurs", value: dashboardData.count },
                    ]}
                    colors={['#10b981', '#ec4899']} // emerald, pink
                  />
                </div>
              </>
            )}

            {/* Recent Transactions List */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Transactions Récentes
              </h3>
              <RecentTransactionsList transactions={recentTransactions} />
            </div>

            {/* Recent Withdrawals List */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                Retraits Récents
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
