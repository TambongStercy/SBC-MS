import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { ApiError, onSessionExpired } from '../api/http';
import type { Agent } from '../api/types';
import { permissionsForRoles } from '../lib/permissions';
import { AuthContext, type AuthContextValue } from './context';
import { authReducer, initialAuthState } from './machine';

/** Fills `permissions` from the roles when a response leaves them out. */
export function normaliseAgent(agent: Agent): Agent {
  const roles = Array.isArray(agent.roles) ? agent.roles : [];
  const permissions = Array.isArray(agent.permissions) && agent.permissions.length ? agent.permissions : permissionsForRoles(roles);
  return { ...agent, roles, permissions };
}

/** The agent from a sign-in response, or from /me when the response has no permissions. */
async function agentAfterSignIn(agent: Agent | undefined): Promise<Agent> {
  if (agent && Array.isArray(agent.permissions)) return normaliseAgent(agent);
  const me = await authApi.me();
  return normaliseAgent(me.agent);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const queryClient = useQueryClient();
  const stateRef = useRef(state);
  stateRef.current = state;

  // Is there a session already (cookie from an earlier visit)?
  useEffect(() => {
    let cancelled = false;
    authApi.me()
      .then(r => { if (!cancelled) dispatch({ type: 'SESSION_FOUND', agent: normaliseAgent(r.agent) }); })
      .catch(() => { if (!cancelled) dispatch({ type: 'NO_SESSION' }); });
    return () => { cancelled = true; };
  }, []);

  // A refresh that fails anywhere in the app ends the session.
  useEffect(() => onSessionExpired(() => {
    queryClient.clear();
    dispatch({ type: 'SESSION_EXPIRED' });
  }), [queryClient]);

  const challengeId = () => {
    const s = stateRef.current;
    if (s.status === 'totp' || s.status === 'enroll') return s.challengeId;
    throw new ApiError(400, 'Recommencez la connexion.', 'NO_CHALLENGE');
  };

  const login = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    const r = await authApi.login({ email, password, ...(turnstileToken ? { turnstileToken } : {}) });
    dispatch({ type: 'PASSWORD_ACCEPTED', step: r.step, challengeId: r.challengeId });
  }, []);

  const submitTotp = useCallback(async (input: { code?: string; backupCode?: string }) => {
    const r = await authApi.totp({ challengeId: challengeId(), ...input });
    dispatch({ type: 'TOTP_ACCEPTED', agent: await agentAfterSignIn(r.agent) });
  }, []);

  const startEnroll = useCallback(async () => {
    const r = await authApi.enrollStart(challengeId());
    dispatch({ type: 'ENROLL_STARTED', enrollment: r });
  }, []);

  const confirmEnroll = useCallback(async (code: string) => {
    const r = await authApi.enrollConfirm(challengeId(), code);
    dispatch({ type: 'ENROLL_CONFIRMED', agent: await agentAfterSignIn(r.agent), backupCodes: r.backupCodes });
  }, []);

  const backupCodesSaved = useCallback(() => dispatch({ type: 'BACKUP_CODES_SAVED' }), []);
  const restart = useCallback(() => dispatch({ type: 'RESTART' }), []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* the cookies expire anyway */ }
    queryClient.clear();
    dispatch({ type: 'LOGGED_OUT' });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, submitTotp, startEnroll, confirmEnroll, backupCodesSaved, restart, logout }),
    [state, login, submitTotp, startEnroll, confirmEnroll, backupCodesSaved, restart, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
