import { createContext, useContext, useMemo } from 'react';
import type { Agent } from '../api/types';
import type { AuthState } from './machine';
import type { Permission, PermissionSet } from '../lib/permissions';

export interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>;
  submitTotp: (input: { code?: string; backupCode?: string }) => Promise<void>;
  startEnroll: () => Promise<void>;
  confirmEnroll: (code: string) => Promise<void>;
  backupCodesSaved: () => void;
  restart: () => void;
  logout: () => Promise<void>;
}

const NO_PERMISSIONS: string[] = [];

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in agent (only inside the signed-in shell). */
export function useAgent(): Agent {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useAgent without a session');
  return state.agent;
}

/** The signed-in agent's permissions as a set (empty when signed out). */
export function usePermissions(): PermissionSet {
  const { state } = useAuth();
  const perms = state.status === 'authenticated' ? state.agent.permissions : NO_PERMISSIONS;
  return useMemo(() => new Set(perms), [perms]);
}

export function useCan(...need: Permission[]): boolean {
  const have = usePermissions();
  return need.every(p => have.has(p));
}
