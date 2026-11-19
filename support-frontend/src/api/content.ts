import { api } from './http';
import type { GuideNode, KbArticle, KbArticleSummary, ResponseTemplate } from './types';

export const templatesApi = {
  list: (q?: { category?: string; language?: string }) => api.get<ResponseTemplate[]>('/templates', q),
  create: (t: Omit<ResponseTemplate, 'id' | 'updatedAt'>) => api.post<ResponseTemplate>('/templates', t),
  update: (id: string, t: Omit<ResponseTemplate, 'id' | 'updatedAt'>) => api.put<ResponseTemplate>(`/templates/${encodeURIComponent(id)}`, t),
  remove: (id: string) => api.del<void>(`/templates/${encodeURIComponent(id)}`),
};

export const kbApi = {
  list: (q?: { q?: string; status?: string; category?: string }) => api.get<KbArticleSummary[]>('/kb/articles', q),
  categories: () => api.get<{ key: string; label: string }[]>('/kb/categories'),
  get: (id: string) => api.get<KbArticle>(`/kb/articles/${encodeURIComponent(id)}`),
  create: (a: { title: string; slug: string; category: string; body: string }) => api.post<KbArticle>('/kb/articles', a),
  /** Saves a new draft version. */
  update: (id: string, a: { title: string; slug: string; category: string; body: string }) => api.put<KbArticle>(`/kb/articles/${encodeURIComponent(id)}`, a),
  publish: (id: string, version: number) => api.post<KbArticle>(`/kb/articles/${encodeURIComponent(id)}/publish`, { version }),
  unpublish: (id: string) => api.post<KbArticle>(`/kb/articles/${encodeURIComponent(id)}/unpublish`),
};

export const guidesApi = {
  get: () => api.get<{ nodes: GuideNode[]; updatedAt?: string }>('/guides'),
  save: (nodes: GuideNode[]) => api.put<{ nodes: GuideNode[] }>('/guides', { nodes }),
};
