import React, { createContext, useState, useContext, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminUserData, loginAdmin, AdminLoginStep, AdminLoginResponse } from '../services/adminUserApi';
import { getMyAccess } from '../services/adminStaffApi';
import { roleFromToken } from '../lib/roles';
import { permissionsForRole, sanitizePermissions, type Permissions } from '../lib/permissions';

/** The signed-in admin as stored (localStorage 'adminUser'), with their rights. */
export type AdminSessionUser = Omit<AdminUserData, 'password' | 'otps' | 'contactsOtps' | 'token'> & {
  /** Effective per-module access, from the login answer then GET /users/admin/me/access. */
  adminPermissions?: Permissions;
};

export interface AuthContextType {
  isAdminAuthenticated: boolean;
  adminUser: AdminSessionUser | null;
  token: string | null;
  /** The account's current role (refreshed from the server), for labels only. */
  role: string | null;
  /**
   * What this account may open, per module. null = not known yet (a staff
   * session from before per-module access, waiting for the server's answer).
   */
  permissions: Permissions | null;
  /** The last rights check failed for a reason other than "no access" (network, 503). */
  accessError: boolean;
  /** Asks the server for this account's rights again. */
  refreshAccess: () => Promise<void>;
  /** Step one: checks the password; the next step is the authenticator (or, the first time, the emailed code). */
  login: (credentials: { email: string; password: string }) => Promise<AdminLoginStep>;
  /** Last step done (authenticator code or set-up): keeps the session. */
  finishLogin: (session: AdminLoginResponse) => void;
  logout: () => void;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Rights are re-read at most this often when the window regains focus. */
const FOCUS_REFRESH_MS = 60 * 1000;

function readStoredUser(): AdminSessionUser | null {
  const storedUser = localStorage.getItem('adminUser');
  try {
    return storedUser ? JSON.parse(storedUser) : null;
  } catch (error) {
    console.error("Failed to parse stored admin user:", error);
    localStorage.removeItem('adminUser');
    return null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('adminToken'));
  const [adminUser, setAdminUser] = useState<AdminSessionUser | null>(readStoredUser);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [accessError, setAccessError] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const lastRefresh = useRef(0);

  useEffect(() => {
    // Update local storage when state changes
    if (token) {
      localStorage.setItem('adminToken', token);
    } else {
      localStorage.removeItem('adminToken');
    }
    if (adminUser) {
      localStorage.setItem('adminUser', JSON.stringify(adminUser));
    } else {
      localStorage.removeItem('adminUser');
    }
  }, [token, adminUser]);

  const login = async (credentials: { email: string; password: string }): Promise<AdminLoginStep> => {
    setIsLoading(true);
    try {
      return await loginAdmin(credentials);
    } finally {
      setIsLoading(false);
    }
  };

  const finishLogin = useCallback((response: AdminLoginResponse) => {
    if (!response.token || !response.user) throw new Error('Réponse de connexion incomplète.');
    const { adminPermissions, ...user } = response.user;
    lastRefresh.current = Date.now();
    setAccessError(false);
    setToken(response.token);
    setAdminUser(adminPermissions ? { ...user, adminPermissions: sanitizePermissions(adminPermissions) } : user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAdminUser(null);
    setAccessError(false);
    // localStorage is cleared by the effect above; the route guard sends to /login.
  }, []);

  const refreshAccess = useCallback(async () => {
    const asked = tokenRef.current;
    if (!asked) return;
    lastRefresh.current = Date.now();
    try {
      const access = await getMyAccess();
      if (tokenRef.current !== asked) return; // signed out or in again meanwhile
      setAccessError(false);
      setAdminUser(u => (u ? { ...u, role: access.role, adminPermissions: access.permissions } : u));
    } catch (error) {
      if (tokenRef.current !== asked) return;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 401 || status === 403) {
        // The server no longer accepts this account in the admin.
        toast.error('Votre accès à l’administration n’est plus valide. Reconnectez-vous.', { id: 'admin-session-ended' });
        logout();
        return;
      }
      setAccessError(true);
    }
  }, [logout]);

  // On load and after each sign-in: the rights may have changed since.
  useEffect(() => {
    if (token) void refreshAccess();
  }, [token, refreshAccess]);

  // Back on the tab: re-read the rights, at most once a minute.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRefresh.current < FOCUS_REFRESH_MS) return;
      void refreshAccess();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshAccess]);

  const role = adminUser?.role ?? roleFromToken(token) ?? null;
  // Sessions opened before the server sent adminPermissions fall back on the role.
  const permissions = useMemo<Permissions | null>(() => {
    if (!token) return null;
    if (adminUser?.adminPermissions) return sanitizePermissions(adminUser.adminPermissions);
    return permissionsForRole(roleFromToken(token) ?? adminUser?.role);
  }, [token, adminUser]);

  return (
    <AuthContext.Provider value={{
      isAdminAuthenticated: !!token, adminUser, token, role, permissions, accessError, refreshAccess,
      login, finishLogin, logout, isLoading,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
