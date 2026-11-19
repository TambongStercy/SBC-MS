import { api, request } from './http';
import type { AgentReport } from './types';

export const reportsApi = {
  agents: (q: { from: string; to: string; agentId?: string }) => api.get<AgentReport>('/reports/agents', q),
  /** CSV download (permission `export`; the server logs it). */
  exportAgents: async (q: { from: string; to: string; agentId?: string }): Promise<Blob> => {
    const res = await request<Response>('GET', '/reports/agents/export', { query: q, raw: true });
    return res.blob();
  },
};
