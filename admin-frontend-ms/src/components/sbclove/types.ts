import type { useUrlFilters } from '../moduleKit';

export const LOVE_FILTER_KEYS = ['tab', 'status', 'q', 'limit'] as const;
export type LoveFilterKey = typeof LOVE_FILTER_KEYS[number];
/** URL state of the SBC Love page (tab + the current tab's filters). */
export type LoveFilters = ReturnType<typeof useUrlFilters<LoveFilterKey>>;

/** Country + period of the page filter row, as the API takes them. */
export interface ApiFilters { country?: string; from?: string; to?: string }
/** Queues (to validate, open reports) ignore the period: country only. */
export const queueScope = (api: ApiFilters): ApiFilters => (api.country ? { country: api.country } : {});

export const MEMBER_LIMITS = [10, 25, 50, 100];
