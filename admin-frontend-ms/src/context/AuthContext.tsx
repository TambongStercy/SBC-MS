import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { AdminUserData, loginAdmin, verifyAdminLoginOtp, AdminLoginChallenge } from '../services/adminUserApi';
import { roleFromToken } from '../lib/roles';

interface AuthContextType {
  isAdminAuthenticated: boolean;
  adminUser: Omit<AdminUserData, 'password' | 'otps' | 'contactsOtps' | 'token'> | null;
  token: string | null;
  /** From the session token; the stored user only as a fallback. */
  role: string | null;
  /** Step one: checks the password and emails a code. */
  login: (credentials: { email: string; password: string }) => Promise<AdminLoginChallenge>;
  /** Step two: exchanges the emailed code for the session. */
  verifyLoginCode: (userId: string, code: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('adminToken'));
  const [adminUser, setAdminUser] = useState<Omit<AdminUserData, 'password' | 'otps' | 'contactsOtps' | 'token'> | null>(() => {
    const storedUser = localStorage.getItem('adminUser');
    try {
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      console.error("Failed to parse stored admin user:", error);
      localStorage.removeItem('adminUser');
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false); // Add loading state for login

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

  const login = async (credentials: { email: string; password: string }): Promise<AdminLoginChallenge> => {
    setIsLoading(true);
    try {
      return await loginAdmin(credentials);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyLoginCode = async (userId: string, code: string): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await verifyAdminLoginOtp(userId, code);
      if (!response.token || !response.user) {
        throw new Error('Login response missing token or user data');
      }
      setToken(response.token);
      setAdminUser(response.user);
    } catch (error) {
      setToken(null);
      setAdminUser(null);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    setAdminUser(null);
    // Optionally: could call a backend logout endpoint if one exists
    // localStorage is cleared by the useEffect hook
    // Redirect might happen in the component calling logout or via a route guard
  };

  return (
    <AuthContext.Provider value={{ isAdminAuthenticated: !!token, adminUser, token, role: roleFromToken(token) ?? adminUser?.role ?? null, login, verifyLoginCode, logout, isLoading }}>
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
