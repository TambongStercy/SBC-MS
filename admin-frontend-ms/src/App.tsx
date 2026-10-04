import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import AppShell from './shell/AppShell';
import { LegacyFrame } from './shell/LegacyFrame';
import { AppToaster, Spinner } from './ui';
import { SocketProvider } from './contexts/SocketContext';

// New screens
const HomePage = lazy(() => import('./features/home/HomePage'));
const ProofQueuePage = lazy(() => import('./features/queues/ProofQueuePage'));
const WithdrawalQueuePage = lazy(() => import('./features/queues/WithdrawalQueuePage'));
const ArgentHub = lazy(() => import('./features/hubs/ArgentHub'));
const ModulesHub = lazy(() => import('./features/hubs/ModulesHub'));
const PlusHub = lazy(() => import('./features/hubs/PlusHub'));

// Pages still to be rebuilt, shown in their old look
const OverViewPage = lazy(() => import('./pages/overViewPage'));
const Deconnexion = lazy(() => import('./pages/Deconnexion'));
const Users = lazy(() => import('./pages/Users'));
const UsersPage = lazy(() => import('./pages/usersPage'));
const Partners = lazy(() => import('./pages/Partners'));
const UserRolesManagement = lazy(() => import('./pages/UserRolesManagement'));
const UserFinancialAnalyticsPage = lazy(() => import('./pages/UserFinancialAnalyticsPage'));
const ProductsManagementPage = lazy(() => import('./pages/ProductsManagementPage'));
const TombolaManagementPage = lazy(() => import('./pages/TombolaManagementPage'));
const TombolaDrawPage = lazy(() => import('./pages/TombolaDrawPage'));
const SbcLoveManagementPage = lazy(() => import('./pages/SbcLoveManagementPage'));
const TransactionManagementPage = lazy(() => import('./pages/TransactionManagementPage'));
const AccountTransactionsManagementPage = lazy(() => import('./pages/AccountTransactionsManagementPage'));
const SettingsManagementPage = lazy(() => import('./pages/SettingsManagementPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PushAnnouncementsPage = lazy(() => import('./pages/PushAnnouncementsPage'));
const FixFeexpayPaymentsPage = lazy(() => import('./pages/FixFeexpayPaymentsPage'));
const FixMoneyFusionWithdrawalsPage = lazy(() => import('./pages/FixMoneyFusionWithdrawalsPage'));
const FixCinetPayWithdrawalsPage = lazy(() => import('./pages/FixCinetPayWithdrawalsPage'));
const FixProviderIssuesPage = lazy(() => import('./pages/FixProviderIssuesPage'));
const ManualPaymentRecoveryPage = lazy(() => import('./pages/ManualPaymentRecoveryPage'));
const StorageMonitoringPage = lazy(() => import('./pages/StorageMonitoringPage'));
const RelanceDashboardPage = lazy(() => import('./pages/RelanceDashboardPage'));
const RelanceMessagesPage = lazy(() => import('./pages/RelanceMessagesPage'));
const RelanceCampaignsPage = lazy(() => import('./pages/RelanceCampaignsPage'));
const RelanceSmsTemplatesPage = lazy(() => import('./pages/RelanceSmsTemplatesPage'));
const WithdrawalApprovalPage = lazy(() => import('./pages/WithdrawalApprovalPage'));
const WithdrawalHistoryPage = lazy(() => import('./pages/WithdrawalHistoryPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const ImpactChallengePage = lazy(() => import('./pages/ImpactChallengePage'));
const ChallengeDetailsPage = lazy(() => import('./pages/ChallengeDetailsPage'));
const AdsNetworkDashboardPage = lazy(() => import('./pages/AdsNetworkDashboardPage'));
const AdsNetworkReviewPage = lazy(() => import('./pages/AdsNetworkReviewPage'));
const AdsNetworkCampaignsPage = lazy(() => import('./pages/AdsNetworkCampaignsPage'));
const AdsNetworkDiffuseursPage = lazy(() => import('./pages/AdsNetworkDiffuseursPage'));
const AdsNetworkTestCampaignPage = lazy(() => import('./pages/AdsNetworkTestCampaignPage'));
const EventDashboardPage = lazy(() => import('./pages/EventDashboardPage'));
const EventOrganizersPage = lazy(() => import('./pages/EventOrganizersPage'));
const EventListPage = lazy(() => import('./pages/EventListPage'));
const EventOrdersPage = lazy(() => import('./pages/EventOrdersPage'));
const EventListingsPage = lazy(() => import('./pages/EventListingsPage'));
const EventDisputesPage = lazy(() => import('./pages/EventDisputesPage'));
const EventCommissionsPage = lazy(() => import('./pages/EventCommissionsPage'));
const EventTicketsPage = lazy(() => import('./pages/EventTicketsPage'));

const legacy = (page: ReactNode) => <LegacyFrame>{page}</LegacyFrame>;

function App() {
  return (
    <>
      <AppToaster />
      <Suspense fallback={<Spinner className="min-h-[50vh]" />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              {/* À traiter */}
              <Route path="/" element={<HomePage />} />
              <Route path="/a-traiter/verifications" element={<ProofQueuePage />} />
              <Route path="/a-traiter/retraits" element={<WithdrawalQueuePage />} />

              {/* Membres */}
              <Route path="/membres" element={legacy(<Users />)} />
              <Route path="/membres/:userId" element={legacy(<UsersPage />)} />
              <Route path="/users" element={<Navigate to="/membres" replace />} />
              <Route path="/userpage/:userId" element={legacy(<UsersPage />)} />
              <Route path="/partners" element={legacy(<Partners />)} />
              <Route path="/user-analytics" element={legacy(<UserFinancialAnalyticsPage />)} />

              {/* Argent */}
              <Route path="/argent" element={<ArgentHub />} />
              <Route path="/argent/bloques" element={legacy(<FixProviderIssuesPage />)} />
              <Route path="/withdrawals/approvals" element={legacy(<WithdrawalApprovalPage />)} />
              <Route path="/withdrawals/history" element={legacy(<WithdrawalHistoryPage />)} />
              <Route path="/transactions" element={legacy(<TransactionManagementPage />)} />
              <Route path="/account-transactions" element={legacy(<AccountTransactionsManagementPage />)} />
              <Route path="/fix-provider-issues" element={<Navigate to="/argent/bloques" replace />} />
              <Route path="/fix-feexpay-payments" element={legacy(<FixFeexpayPaymentsPage />)} />
              <Route path="/fix-moneyfusion-withdrawals" element={legacy(<FixMoneyFusionWithdrawalsPage />)} />
              <Route path="/fix-cinetpay-withdrawals" element={legacy(<FixCinetPayWithdrawalsPage />)} />
              <Route path="/manual-payment-recovery" element={legacy(<ManualPaymentRecoveryPage />)} />

              {/* Modules */}
              <Route path="/modules" element={<ModulesHub />} />
              <Route path="/ads-network" element={legacy(<AdsNetworkDashboardPage />)} />
              <Route path="/ads-network/review" element={legacy(<AdsNetworkReviewPage />)} />
              <Route path="/ads-network/manual-verifications" element={<Navigate to="/a-traiter/verifications" replace />} />
              <Route path="/ads-network/campaigns" element={legacy(<AdsNetworkCampaignsPage />)} />
              <Route path="/ads-network/diffuseurs" element={legacy(<AdsNetworkDiffuseursPage />)} />
              <Route path="/ads-network/test-campaign" element={legacy(<AdsNetworkTestCampaignPage />)} />
              <Route path="/event" element={legacy(<EventDashboardPage />)} />
              <Route path="/event/organizers" element={legacy(<EventOrganizersPage />)} />
              <Route path="/event/events" element={legacy(<EventListPage />)} />
              <Route path="/event/orders" element={legacy(<EventOrdersPage />)} />
              <Route path="/event/tickets" element={legacy(<EventTicketsPage />)} />
              <Route path="/event/listings" element={legacy(<EventListingsPage />)} />
              <Route path="/event/disputes" element={legacy(<EventDisputesPage />)} />
              <Route path="/event/commissions" element={legacy(<EventCommissionsPage />)} />
              <Route path="/relance/dashboard" element={legacy(<RelanceDashboardPage />)} />
              <Route path="/relance/messages" element={legacy(<RelanceMessagesPage />)} />
              <Route path="/relance/campaigns" element={legacy(<RelanceCampaignsPage />)} />
              <Route path="/relance/sms-templates" element={legacy(<RelanceSmsTemplatesPage />)} />
              <Route path="/sbclove" element={legacy(<SbcLoveManagementPage />)} />
              <Route path="/tombola" element={legacy(<TombolaManagementPage />)} />
              <Route path="/tombola/draw/:monthId" element={legacy(<TombolaDrawPage />)} />
              <Route path="/products" element={legacy(<ProductsManagementPage />)} />
              <Route path="/impact-challenges" element={legacy(<ImpactChallengePage />)} />
              <Route path="/impact-challenges/:challengeId" element={legacy(<ChallengeDetailsPage />)} />

              {/* Plus */}
              <Route path="/plus" element={<PlusHub />} />
              <Route path="/notifications/push" element={legacy(<PushAnnouncementsPage />)} />
              <Route path="/notifications" element={legacy(<NotificationsPage />)} />
              <Route path="/statuses" element={legacy(<SocketProvider><StatusPage /></SocketProvider>)} />
              <Route path="/settings" element={legacy(<SettingsManagementPage />)} />
              <Route path="/user-roles" element={legacy(<UserRolesManagement />)} />
              <Route path="/storage" element={legacy(<StorageMonitoringPage />)} />
              <Route path="/dashboard" element={legacy(<OverViewPage />)} />
              <Route path="/chat" element={<Navigate to="/" replace />} />
              <Route path="/logout" element={legacy(<Deconnexion />)} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
