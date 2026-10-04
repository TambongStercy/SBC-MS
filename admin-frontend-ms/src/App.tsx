import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import AppShell from './shell/AppShell';
import { LegacyFrame } from './shell/LegacyFrame';
import { AppToaster, Spinner } from './ui';

// New screens
const HomePage = lazy(() => import('./features/home/HomePage'));
const ProofQueuePage = lazy(() => import('./features/queues/ProofQueuePage'));
const WithdrawalQueuePage = lazy(() => import('./features/queues/WithdrawalQueuePage'));
const ArgentHub = lazy(() => import('./features/hubs/ArgentHub'));
const ModulesHub = lazy(() => import('./features/hubs/ModulesHub'));
const PlusHub = lazy(() => import('./features/hubs/PlusHub'));
const MembersPage = lazy(() => import('./features/members/MembersPage'));
const MemberPage = lazy(() => import('./features/members/MemberPage'));
const WithdrawalsPage = lazy(() => import('./features/money/WithdrawalsPage'));
const StuckPage = lazy(() => import('./features/money/StuckPage'));
const PaymentsPage = lazy(() => import('./features/money/PaymentsPage'));
const GatewaysPage = lazy(() => import('./features/money/GatewaysPage'));
const ResolvePage = lazy(() => import('./features/money/ResolvePage'));
const RecoveryPage = lazy(() => import('./features/money/RecoveryPage'));
const AnalysisPage = lazy(() => import('./features/money/AnalysisPage'));
const AnnouncementsPage = lazy(() => import('./features/plus/AnnouncementsPage'));
const ContentPage = lazy(() => import('./features/plus/ContentPage'));
const StoriesPage = lazy(() => import('./features/plus/StoriesPage'));
const WhatsAppPage = lazy(() => import('./features/plus/WhatsAppPage'));
const RolesPage = lazy(() => import('./features/plus/RolesPage'));
const StoragePage = lazy(() => import('./features/plus/StoragePage'));
const StatsPage = lazy(() => import('./features/plus/StatsPage'));
const AdsModule = lazy(() => import('./features/modules/ads/AdsModule'));
const BilletterieModule = lazy(() => import('./features/modules/billetterie/BilletterieModule'));
const EventDetailPage = lazy(() => import('./features/modules/billetterie/EventDetailPage'));
const RelanceModule = lazy(() => import('./features/modules/relance/RelanceModule'));
const SbcLoveModule = lazy(() => import('./features/modules/sbclove/SbcLoveModule'));
const TombolaModule = lazy(() => import('./features/modules/tombola/TombolaModule'));
const TombolaDrawModulePage = lazy(() => import('./features/modules/tombola/TombolaDrawPage'));
const BoutiqueModule = lazy(() => import('./features/modules/boutique/BoutiqueModule'));
const ChallengesModule = lazy(() => import('./features/modules/challenges/ChallengesModule'));
const ChallengeDetailPage = lazy(() => import('./features/modules/challenges/ChallengeDetailPage'));

// Pages still to be rebuilt, shown in their old look
const Deconnexion = lazy(() => import('./pages/Deconnexion'));
const ProductsManagementPage = lazy(() => import('./pages/ProductsManagementPage'));
const TombolaManagementPage = lazy(() => import('./pages/TombolaManagementPage'));
const TombolaDrawPage = lazy(() => import('./pages/TombolaDrawPage'));
const SbcLoveManagementPage = lazy(() => import('./pages/SbcLoveManagementPage'));
const RelanceDashboardPage = lazy(() => import('./pages/RelanceDashboardPage'));
const RelanceMessagesPage = lazy(() => import('./pages/RelanceMessagesPage'));
const RelanceCampaignsPage = lazy(() => import('./pages/RelanceCampaignsPage'));
const RelanceSmsTemplatesPage = lazy(() => import('./pages/RelanceSmsTemplatesPage'));
const ImpactChallengePage = lazy(() => import('./pages/ImpactChallengePage'));
const ChallengeDetailsPage = lazy(() => import('./pages/ChallengeDetailsPage'));
const EventDashboardPage = lazy(() => import('./pages/EventDashboardPage'));
const EventOrganizersPage = lazy(() => import('./pages/EventOrganizersPage'));
const EventListPage = lazy(() => import('./pages/EventListPage'));
const EventOrdersPage = lazy(() => import('./pages/EventOrdersPage'));
const EventListingsPage = lazy(() => import('./pages/EventListingsPage'));
const EventDisputesPage = lazy(() => import('./pages/EventDisputesPage'));
const EventCommissionsPage = lazy(() => import('./pages/EventCommissionsPage'));
const EventTicketsPage = lazy(() => import('./pages/EventTicketsPage'));

const legacy = (page: ReactNode) => <LegacyFrame>{page}</LegacyFrame>;

/** Old member links (/userpage/:id) land on the new member page. */
function OldMemberLink() {
  const { userId } = useParams();
  return <Navigate to={`/membres/${userId}`} replace />;
}

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
              <Route path="/membres" element={<MembersPage />} />
              <Route path="/membres/:userId" element={<MemberPage />} />
              <Route path="/users" element={<Navigate to="/membres" replace />} />
              <Route path="/userpage/:userId" element={<OldMemberLink />} />
              <Route path="/partners" element={<Navigate to="/membres?partenaire=any" replace />} />

              {/* Argent */}
              <Route path="/argent" element={<ArgentHub />} />
              <Route path="/argent/retraits" element={<WithdrawalsPage />} />
              <Route path="/argent/bloques" element={<StuckPage />} />
              <Route path="/argent/paiements" element={<PaymentsPage />} />
              <Route path="/argent/passerelles" element={<GatewaysPage />} />
              <Route path="/argent/resoudre" element={<ResolvePage />} />
              <Route path="/argent/resoudre/abonnement" element={<RecoveryPage />} />
              <Route path="/argent/analyse" element={<AnalysisPage />} />
              <Route path="/withdrawals/approvals" element={<Navigate to="/argent/retraits" replace />} />
              <Route path="/withdrawals/history" element={<Navigate to="/argent/retraits?vue=historique" replace />} />
              <Route path="/transactions" element={<Navigate to="/argent/paiements" replace />} />
              <Route path="/account-transactions" element={<Navigate to="/argent/paiements?vue=mouvements" replace />} />
              <Route path="/user-analytics" element={<Navigate to="/argent/analyse" replace />} />
              <Route path="/fix-provider-issues" element={<Navigate to="/argent/bloques" replace />} />
              <Route path="/fix-moneyfusion-withdrawals" element={<Navigate to="/argent/bloques?fournisseur=moneyfusion" replace />} />
              <Route path="/fix-cinetpay-withdrawals" element={<Navigate to="/argent/bloques?fournisseur=cinetpay" replace />} />
              <Route path="/fix-feexpay-payments" element={<Navigate to="/argent/resoudre?probleme=paye" replace />} />
              <Route path="/manual-payment-recovery" element={<Navigate to="/argent/resoudre/abonnement" replace />} />

              {/* Modules */}
              <Route path="/modules" element={<ModulesHub />} />
              <Route path="/modules/ads" element={<AdsModule />} />
              <Route path="/modules/billetterie" element={<BilletterieModule />} />
              <Route path="/modules/billetterie/evenements/:eventId" element={<EventDetailPage />} />
              <Route path="/modules/relance" element={<RelanceModule />} />
              <Route path="/modules/sbc-love" element={<SbcLoveModule />} />
              <Route path="/modules/tombola" element={<TombolaModule />} />
              <Route path="/modules/tombola/tirage/:monthId" element={<TombolaDrawModulePage />} />
              <Route path="/modules/boutique" element={<BoutiqueModule />} />
              <Route path="/modules/impact-challenge" element={<ChallengesModule />} />
              <Route path="/modules/impact-challenge/:challengeId" element={<ChallengeDetailPage />} />
              <Route path="/ads-network" element={<Navigate to="/modules/ads" replace />} />
              <Route path="/ads-network/review" element={<Navigate to="/modules/ads?onglet=campagnes&statut=a-valider" replace />} />
              <Route path="/ads-network/manual-verifications" element={<Navigate to="/a-traiter/verifications" replace />} />
              <Route path="/ads-network/campaigns" element={<Navigate to="/modules/ads?onglet=campagnes" replace />} />
              <Route path="/ads-network/diffuseurs" element={<Navigate to="/modules/ads?onglet=diffuseurs" replace />} />
              <Route path="/ads-network/test-campaign" element={<Navigate to="/modules/ads?onglet=reglages" replace />} />
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
              <Route path="/plus/annonces" element={<AnnouncementsPage />} />
              <Route path="/plus/contenu" element={<ContentPage />} />
              <Route path="/plus/stories" element={<StoriesPage />} />
              <Route path="/plus/whatsapp" element={<WhatsAppPage />} />
              <Route path="/plus/roles" element={<RolesPage />} />
              <Route path="/plus/stockage" element={<StoragePage />} />
              <Route path="/plus/statistiques" element={<StatsPage />} />
              <Route path="/notifications/push" element={<Navigate to="/plus/annonces" replace />} />
              <Route path="/notifications" element={<Navigate to="/plus/whatsapp" replace />} />
              <Route path="/statuses" element={<Navigate to="/plus/stories" replace />} />
              <Route path="/settings" element={<Navigate to="/plus/contenu" replace />} />
              <Route path="/user-roles" element={<Navigate to="/plus/roles" replace />} />
              <Route path="/storage" element={<Navigate to="/plus/stockage" replace />} />
              <Route path="/dashboard" element={<Navigate to="/plus/statistiques" replace />} />
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
