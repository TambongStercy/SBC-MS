import React, { useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockKeyIcon, Logout01Icon, RefreshIcon, WifiError01Icon } from '@hugeicons/core-free-icons';
import { useAuth } from '../context/AuthContext';
import Loader from './common/loader';
import { canOpenPath, hasAnyModule, homeFor } from '../lib/permissions';
import { logoutAdmin } from '../api/admin';
import { BrandLogo } from '../shell/BrandMark';
import { Button, EmptyState, Panel } from './ui';

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-background px-4 py-8 text-fg">
      <BrandLogo size={40} />
      <Panel className="w-full max-w-md shadow-panel">{children}</Panel>
    </div>
  );
}

/** For an account that cannot open anything: say so, offer to retry or sign out. */
function NoAccess({ error }: { error: boolean }) {
  const { refreshAccess, logout } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try { await refreshAccess(); } finally { setRetrying(false); }
  };
  const signOut = async () => {
    setLeaving(true);
    try { await logoutAdmin(); } catch { /* signed out locally anyway */ }
    logout();
  };

  return (
    <FullScreen>
      <EmptyState
        icon={error ? WifiError01Icon : LockKeyIcon}
        title={error ? 'Impossible de vérifier vos droits' : 'Aucun accès pour le moment'}
        description={error
          ? 'Le serveur n’a pas répondu. Vérifiez la connexion, puis réessayez.'
          : 'Votre compte ne peut ouvrir aucun espace de l’administration. Demandez à un super admin de vous donner des droits, puis réessayez.'}
        action={(
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" size="lg" onClick={signOut} loading={leaving}>
              {!leaving && <HugeiconsIcon icon={Logout01Icon} size={18} aria-hidden="true" />}
              Se déconnecter
            </Button>
            <Button variant="primary" size="lg" onClick={retry} loading={retrying}>
              {!retrying && <HugeiconsIcon icon={RefreshIcon} size={18} aria-hidden="true" />}
              Réessayer
            </Button>
          </div>
        )}
      />
    </FullScreen>
  );
}

const ProtectedRoute: React.FC = () => {
  const { isAdminAuthenticated, isLoading, permissions, accessError } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center overflow-auto bg-background">
        <Loader name="Authentication" />
      </div>
    );
  }

  if (!isAdminAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Rights not known yet (older staff session): wait for the server's answer.
  if (!permissions) {
    if (accessError) return <NoAccess error />;
    return (
      <div className="flex h-dvh w-full items-center justify-center overflow-auto bg-background">
        <Loader name="Authentication" />
      </div>
    );
  }

  if (!hasAnyModule(permissions) && location.pathname !== '/logout') {
    return <NoAccess error={false} />;
  }

  // A screen this account cannot read sends it to its first readable page.
  if (!canOpenPath(permissions, location.pathname)) {
    return <Navigate to={homeFor(permissions) ?? '/logout'} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
