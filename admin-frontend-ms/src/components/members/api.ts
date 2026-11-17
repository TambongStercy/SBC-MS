import axios from 'axios';
import apiClient from '../../api/apiClient';
import type {
  AdminUserData, AdminUserListFilters, PartnerData, PartnerSummaryData, UserSummaryStats,
} from '../../services/adminUserApi';

/**
 * The Membres pages' list and stat calls with the shared country/period
 * filters (`country`, `from`, `to`). services/adminUserApi.ts is shared with
 * other screens (Équipe, chat, Impact Challenge pickers), so the extra params
 * go through here instead of changing its signatures.
 */
export type RangeParams = { country?: string; from?: string; to?: string };

export interface Paged<T> {
  data: T[];
  pagination: { currentPage: number; totalPages: number; totalCount: number; limit: number };
}

const message = (e: unknown, fallback: string) =>
  axios.isAxiosError(e) ? (e.response?.data as { message?: string } | undefined)?.message || fallback : fallback;

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null));

export async function listMembers(filters: AdminUserListFilters, range: RangeParams, page: number, limit: number): Promise<Paged<AdminUserData>> {
  try {
    const res = await apiClient.get('/users/admin/users', {
      params: clean({
        page, limit,
        status: filters.status,
        role: filters.role,
        search: filters.search,
        // the shared country filter wins over a page-level one
        country: range.country ?? filters.country,
        from: range.from,
        to: range.to,
      }),
    });
    return { data: res.data.data ?? [], pagination: res.data.pagination };
  } catch (e) {
    throw new Error(message(e, 'La liste des membres n’a pas pu être chargée.'));
  }
}

export async function memberSummary(range: RangeParams): Promise<UserSummaryStats> {
  try {
    const res = await apiClient.get('/users/admin/stats/user-summary', { params: clean(range) });
    return res.data.data;
  } catch (e) {
    throw new Error(message(e, 'Les chiffres n’ont pas pu être chargés.'));
  }
}

/** Partners; the API answers mongoose-paginate fields (totalDocs, page), normalised here. */
export async function listPartnersFiltered(range: RangeParams, page: number, limit: number): Promise<Paged<PartnerData>> {
  try {
    const res = await apiClient.get('/users/admin/partners', { params: clean({ page, limit, ...range }) });
    const p = (res.data.pagination ?? {}) as Record<string, number>;
    return {
      data: res.data.data ?? [],
      pagination: {
        totalCount: p.totalCount ?? p.totalDocs ?? 0,
        currentPage: p.currentPage ?? p.page ?? page,
        totalPages: p.totalPages ?? 1,
        limit: p.limit ?? limit,
      },
    };
  } catch (e) {
    throw new Error(message(e, 'La liste des partenaires n’a pas pu être chargée.'));
  }
}

export async function partnerSummary(range: RangeParams): Promise<PartnerSummaryData> {
  try {
    const res = await apiClient.get('/users/admin/partners/summary', { params: clean(range) });
    return res.data.data;
  } catch (e) {
    throw new Error(message(e, 'Les chiffres n’ont pas pu être chargés.'));
  }
}
