import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { AdminUserData, loginAdmin, AdminLoginResponse } from '../services/adminUserApi'; // Adjust path as needed

interface AuthContextType {
  isAdminAuthenticated: boolean;
  adminUser: Omit<AdminUserData, 'password' | 'otps' | 'contactsOtps' | 'token'> | null;
  token: string | null;
  login: (credentials: { email: string; password: string }) => Promise<void>;
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

  const login = async (credentials: { email: string; password: string }): Promise<void> => {
    setIsLoading(true);
    try {
      const response: AdminLoginResponse = await loginAdmin(credentials);
      if (response.token && response.user) {
        setToken(response.token);
        setAdminUser(response.user);
      } else {
        throw new Error('Login response missing token or user data');
      }
    } catch (error) {
      console.error("Admin login failed in context:", error);
      setToken(null); // Clear any invalid state
      setAdminUser(null);
      // Re-throw the error so the calling component (e.g., login page) can handle it (show message to user)
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
    <AuthContext.Provider value={{ isAdminAuthenticated: !!token, adminUser, token, login, logout, isLoading }}>
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
