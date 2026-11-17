import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, usePermissions } from './auth/context';
import { FullScreenLoader } from './components/FullScreenLoader';
import { Skeleton } from './components/ui';
import { canOpenPath, homeFor } from './navigation/menu';
import { AppShell } from './shell/AppShell';
import ActivatePage from './pages/auth/ActivatePage';
import LoginPage from './pages/auth/LoginPage';
import LogoutPage from './pages/auth/LogoutPage';
import HomePage from './pages/HomePage';
import { ForbiddenPage, NotFoundPage } from './pages/StatusPages';

// Each workspace is its own chunk: an agent downloads only the screens they open.
const TicketsPage = lazy(() => import('./pages/tickets/TicketsPage'));
const TicketDetailPage = lazy(() => import('./pages/tickets/TicketDetailPage'));
const MembersPage = lazy(() => import('./pages/members/MembersPage'));
const MemberDetailPage = lazy(() => import('./pages/members/MemberDetailPage'));
const ActivationPage = lazy(() => import('./pages/activation/ActivationPage'));
const FinancePage = lazy(() => import('./pages/finance/FinancePage'));
const ApprovalsPage = lazy(() => import('./pages/approvals/ApprovalsPage'));
const VerificationsPage = lazy(() => import('./pages/views/VerificationsPage'));
const SupervisionPage = lazy(() => import('./pages/views/SupervisionPage'));
const ContentPage = lazy(() => import('./pages/content/ContentPage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const AgentsPage = lazy(() => import('./pages/admin/AgentsPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AuditPage = lazy(() => import('./pages/admin/AuditPage'));

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Signed-in area: anyone else goes to the sign-in screen (and comes back after). */
function RequireSession() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'checking') return <FullScreenLoader />;
  if (state.status !== 'authenticated') return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell />;
}

/** Same rule as the menu: a screen the agent cannot open is refused, not half-shown. */
function Guard({ children }: { children: ReactNode }) {
  const perms = usePermissions();
  const { pathname } = useLocation();
  if (!canOpenPath(perms, pathname)) return <ForbiddenPage />;
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const perms = usePermissions();
  const location = useLocation();
  if (state.status === 'checking') return <FullScreenLoader />;
  if (state.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/connexion' && from !== '/deconnexion' ? from : homeFor(perms)} replace />;
  }
  return <>{children}</>;
}

function Home() {
  const perms = usePermissions();
  const home = homeFor(perms);
  return home === '/' ? <HomePage /> : <Navigate to={home} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/activate" element={<ActivatePage />} />
      <Route path="/deconnexion" element={<LogoutPage />} />
      <Route element={<RequireSession />}>
        <Route index element={<Home />} />
        <Route path="tickets" element={<Guard><TicketsPage /></Guard>} />
        <Route path="tickets/:id" element={<Guard><TicketDetailPage /></Guard>} />
        <Route path="membres" element={<Guard><MembersPage /></Guard>} />
        <Route path="membres/:id" element={<Guard><MemberDetailPage /></Guard>} />
        <Route path="activation" element={<Guard><ActivationPage /></Guard>} />
        <Route path="finance" element={<Guard><FinancePage /></Guard>} />
        <Route path="approbations" element={<Guard><ApprovalsPage /></Guard>} />
        <Route path="verifications" element={<Guard><VerificationsPage /></Guard>} />
        <Route path="supervision" element={<Guard><SupervisionPage /></Guard>} />
        <Route path="contenus" element={<Guard><ContentPage /></Guard>} />
        <Route path="rapports" element={<Guard><ReportsPage /></Guard>} />
        <Route path="admin/agents" element={<Guard><AgentsPage /></Guard>} />
        <Route path="admin/reglages" element={<Guard><SettingsPage /></Guard>} />
        <Route path="admin/audit" element={<Guard><AuditPage /></Guard>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
