import { Route, Routes } from "react-router-dom";
import OverViewPage from "./pages/overViewPage";
import Deconnexion from "./pages/Deconnexion";
import Users from "./pages/Users";
import UsersPage from "./pages/usersPage";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import ProductsManagementPage from "./pages/ProductsManagementPage";
import TombolaManagementPage from "./pages/TombolaManagementPage";
import TombolaDrawPage from './pages/TombolaDrawPage';
import SbcLoveManagementPage from "./pages/SbcLoveManagementPage";
import TransactionManagementPage from './pages/TransactionManagementPage';
import AccountTransactionsManagementPage from './pages/AccountTransactionsManagementPage';
import SettingsManagementPage from './pages/SettingsManagementPage';
import NotificationsPage from './pages/NotificationsPage';
import PushAnnouncementsPage from './pages/PushAnnouncementsPage';
import Partners from './pages/Partners';
import FixFeexpayPaymentsPage from './pages/FixFeexpayPaymentsPage';
import FixMoneyFusionWithdrawalsPage from './pages/FixMoneyFusionWithdrawalsPage';
import FixCinetPayWithdrawalsPage from './pages/FixCinetPayWithdrawalsPage';
import FixProviderIssuesPage from './pages/FixProviderIssuesPage';
import ManualPaymentRecoveryPage from './pages/ManualPaymentRecoveryPage';
import StorageMonitoringPage from './pages/StorageMonitoringPage';
import RelanceDashboardPage from './pages/RelanceDashboardPage';
import RelanceMessagesPage from './pages/RelanceMessagesPage';
import RelanceCampaignsPage from './pages/RelanceCampaignsPage';
import RelanceSmsTemplatesPage from './pages/RelanceSmsTemplatesPage';
import WithdrawalApprovalPage from './pages/WithdrawalApprovalPage';
import WithdrawalHistoryPage from './pages/WithdrawalHistoryPage';
import UserFinancialAnalyticsPage from './pages/UserFinancialAnalyticsPage';
import UserRolesManagement from './pages/UserRolesManagement';
import TeamPage from './pages/TeamPage';
import SecurityPage from './pages/SecurityPage';
import ChatPage from './pages/ChatPage';
import StatusPage from './pages/StatusPage';
import ImpactChallengePage from './pages/ImpactChallengePage';
import ChallengeDetailsPage from './pages/ChallengeDetailsPage';
import AdsNetworkDashboardPage from './pages/AdsNetworkDashboardPage';
import AdsNetworkReviewPage from './pages/AdsNetworkReviewPage';
import AdsNetworkManualVerifyPage from './pages/AdsNetworkManualVerifyPage';
import AdsNetworkCampaignsPage from './pages/AdsNetworkCampaignsPage';
import AdsNetworkDiffuseursPage from './pages/AdsNetworkDiffuseursPage';
import AdsNetworkTestCampaignPage from './pages/AdsNetworkTestCampaignPage';
import EventDashboardPage from './pages/EventDashboardPage';
import EventOrganizersPage from './pages/EventOrganizersPage';
import EventListPage from './pages/EventListPage';
import EventOrdersPage from './pages/EventOrdersPage';
import EventListingsPage from './pages/EventListingsPage';
import EventDisputesPage from './pages/EventDisputesPage';
import EventCommissionsPage from './pages/EventCommissionsPage';
import EventTicketsPage from './pages/EventTicketsPage';
import EventAnimationPage from './pages/EventAnimationPage';
import { SocketProvider } from './contexts/SocketContext';
import { AppShell } from './shell/AppShell';

function App() {
  return (
    <SocketProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          {/* Every signed-in page is drawn inside the shell (sidebar, header, phone bars). */}
          <Route element={<AppShell />}>
            <Route path="/" element={<OverViewPage />} />
            <Route path="/dashboard" element={<OverViewPage />} />
            <Route path="/users" element={<Users />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/products" element={<ProductsManagementPage />} />
            <Route path="/transactions" element={<TransactionManagementPage />} />
            <Route path="/account-transactions" element={<AccountTransactionsManagementPage />} />
            <Route path="/settings" element={<SettingsManagementPage />} />
            <Route path="/storage" element={<StorageMonitoringPage />} />
            <Route path="/tombola" element={<TombolaManagementPage />} />
            <Route path="/tombola/draw/:monthId" element={<TombolaDrawPage />} />
            <Route path="/sbclove" element={<SbcLoveManagementPage />} />
            <Route path="/logout" element={<Deconnexion />} />
            <Route path="/securite" element={<SecurityPage />} />
            <Route path="/userpage/:userId" element={<UsersPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/notifications/push" element={<PushAnnouncementsPage />} />
            <Route path="/fix-feexpay-payments" element={<FixFeexpayPaymentsPage />} />
            <Route path="/fix-moneyfusion-withdrawals" element={<FixMoneyFusionWithdrawalsPage />} />
            <Route path="/fix-cinetpay-withdrawals" element={<FixCinetPayWithdrawalsPage />} />
            <Route path="/fix-provider-issues" element={<FixProviderIssuesPage />} />
            <Route path="/manual-payment-recovery" element={<ManualPaymentRecoveryPage />} />
            <Route path="/relance/dashboard" element={<RelanceDashboardPage />} />
            <Route path="/relance/messages" element={<RelanceMessagesPage />} />
            <Route path="/relance/campaigns" element={<RelanceCampaignsPage />} />
            <Route path="/relance/sms-templates" element={<RelanceSmsTemplatesPage />} />
            <Route path="/withdrawals/approvals" element={<WithdrawalApprovalPage />} />
            <Route path="/withdrawals/history" element={<WithdrawalHistoryPage />} />
            <Route path="/user-analytics" element={<UserFinancialAnalyticsPage />} />
            <Route path="/user-roles" element={<UserRolesManagement />} />
            <Route path="/equipe" element={<TeamPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/statuses" element={<StatusPage />} />
            <Route path="/impact-challenges" element={<ImpactChallengePage />} />
            <Route path="/impact-challenges/:challengeId" element={<ChallengeDetailsPage />} />
            <Route path="/ads-network" element={<AdsNetworkDashboardPage />} />
            <Route path="/ads-network/review" element={<AdsNetworkReviewPage />} />
            <Route path="/ads-network/manual-verifications" element={<AdsNetworkManualVerifyPage />} />
            <Route path="/ads-network/campaigns" element={<AdsNetworkCampaignsPage />} />
            <Route path="/ads-network/diffuseurs" element={<AdsNetworkDiffuseursPage />} />
            <Route path="/ads-network/test-campaign" element={<AdsNetworkTestCampaignPage />} />

            {/* SBC Event admin */}
            <Route path="/event" element={<EventDashboardPage />} />
            <Route path="/event/organizers" element={<EventOrganizersPage />} />
            <Route path="/event/events" element={<EventListPage />} />
            <Route path="/event/orders" element={<EventOrdersPage />} />
            <Route path="/event/tickets" element={<EventTicketsPage />} />
            <Route path="/event/listings" element={<EventListingsPage />} />
            <Route path="/event/disputes" element={<EventDisputesPage />} />
            <Route path="/event/commissions" element={<EventCommissionsPage />} />
            {/* Animation & Engagement (challenges, votes): ?tab=apercu|defis|a-verifier|demandes|votes|journal|exports */}
            <Route path="/event/animation" element={<EventAnimationPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Login />} />
      </Routes>
    </SocketProvider>
  );
}

export default App;
