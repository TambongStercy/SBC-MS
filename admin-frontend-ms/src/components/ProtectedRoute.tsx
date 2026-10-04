import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Loader from './common/loader';
import { canOpen, HOME_FOR } from '../lib/roles';

const ProtectedRoute: React.FC = () => {
  const { isAdminAuthenticated, isLoading, role } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-bg">
        <Loader />
      </div>
    );
  }

  if (!isAdminAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A limited role landing on a screen it cannot use goes to its own home.
  if (!canOpen(role, location.pathname)) {
    const home = role ? HOME_FOR[role] : undefined;
    return home ? <Navigate to={home} replace /> : <Navigate to="/logout" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
