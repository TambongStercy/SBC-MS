import { api } from './http';
import type { Agent, EnrollStart, LoginResult } from './types';

/** CONTRACT.md §3.1 — /desk/auth/*. */
export const authApi = {
  login: (body: { email: string; password: string; turnstileToken?: string }) => api.post<LoginResult>('/auth/login', body),
  totp: (body: { challengeId: string; code?: string; backupCode?: string }) => api.post<{ agent: Agent }>('/auth/totp', body),
  enrollStart: (challengeId: string) => api.post<EnrollStart>('/auth/enroll/start', { challengeId }),
  enrollConfirm: (challengeId: string, code: string) =>
    api.post<{ agent: Agent; backupCodes: string[] }>('/auth/enroll/confirm', { challengeId, code }),
  activate: (token: string, password: string) => api.post<void>('/auth/activate', { token, password }),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ agent: Agent }>('/auth/me'),
  reauth: (code: string) => api.post<{ reauthToken: string }>('/auth/reauth', { code }),
};
