import { api } from './http';
import type { PersonRef, QaItem, ViewBoard, ViewDecision, ViewSettings, ViewTask, ViewTaskState } from './types';

export const viewsApi = {
  /** The task this verifier holds now, if any. */
  current: () => api.get<{ task: ViewTask | null }>('/views/current'),
  /** "Tâche suivante": idempotent, a repeated call returns the same task. */
  next: () => api.post<{ task: ViewTask | null }>('/views/next'),
  start: (id: string) => api.post<ViewTask>(`/views/tasks/${encodeURIComponent(id)}/start`),
  /** Keeps the task alive while the verifier works (idle detection). */
  heartbeat: (id: string) => api.post<void>(`/views/tasks/${encodeURIComponent(id)}/heartbeat`),
  decide: (id: string, body: { decision: ViewDecision; observedViews?: number; reason?: string; ban?: boolean; version: number }) =>
    api.post<ViewTask>(`/views/tasks/${encodeURIComponent(id)}/decision`, body),
  myQueue: () => api.get<{ items: ViewTask[]; today: { decided: number; approved: number; rejected: number } }>('/views/mine'),
  // Supervisor
  board: () => api.get<ViewBoard>('/views/board'),
  tasks: (state: ViewTaskState) => api.get<ViewTask[]>('/views/tasks', { state }),
  verifiers: () => api.get<PersonRef[]>('/views/verifiers'),
  reassign: (id: string, agentId: string | null, reason: string) =>
    api.post<ViewTask>(`/views/tasks/${encodeURIComponent(id)}/reassign`, { agentId, reason }),
  settings: () => api.get<ViewSettings>('/views/settings'),
  saveSettings: (s: ViewSettings) => api.put<ViewSettings>('/views/settings', s),
  qa: () => api.get<QaItem[]>('/views/qa'),
  qaVerdict: (taskId: string, body: { verdict: 'confirmed' | 'corrected'; decision?: ViewDecision; observedViews?: number; reason: string }) =>
    api.post<QaItem>(`/views/qa/${encodeURIComponent(taskId)}`, body),
};
