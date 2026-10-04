import apiClient from '../../../api/apiClient';
import type { Tone } from '../../../ui';

/** tombola-service, admin side (`/api/tombolas/admin`). One tombola per month; at most one open at a time. */

export type TombolaStatus = 'open' | 'drawing' | 'closed';
export interface Winner { userId: string; prize: string; rank: number; winningTicketNumber: number }
export interface TombolaMonth {
    _id: string;
    month: number;
    year: number;
    status: TombolaStatus;
    startDate: string;
    endDate?: string;
    drawDate?: string;
    winners: Winner[];
    /** Set only on tombolas created with an Impact Challenge: last month's winners, left out of this draw. */
    previousMonthWinners?: string[];
    lastTicketNumber: number;
    createdAt: string;
}
export interface Ticket {
    _id: string;
    userId: string;
    ticketNumber: number;
    purchaseTimestamp: string;
    userName?: string;
    userPhoneNumber?: string;
}
type Paged<T> = { data: T[]; pagination: { page: number; limit: number; totalCount: number; totalPages: number } };

export const listTombolas = async (page: number, limit: number): Promise<Paged<TombolaMonth>> =>
    (await apiClient.get('/tombolas/admin', { params: { page, limit } })).data;
export const getTombola = async (id: string): Promise<TombolaMonth> => (await apiClient.get(`/tombolas/admin/${id}`)).data.data;
export const listTickets = async (id: string, page: number, limit: number, search?: string): Promise<Paged<Ticket>> =>
    (await apiClient.get(`/tombolas/admin/${id}/tickets`, { params: { page, limit, ...(search ? { search } : {}) } })).data;
export const getTicketNumbers = async (id: string): Promise<number[]> => (await apiClient.get(`/tombolas/admin/${id}/ticket-numbers`)).data.data ?? [];
export const createTombola = async (month: number, year: number): Promise<TombolaMonth> => (await apiClient.post('/tombolas/admin', { month, year })).data.data;
export const setTombolaStatus = async (id: string, status: 'open' | 'closed'): Promise<TombolaMonth> =>
    (await apiClient.patch(`/tombolas/admin/${id}/status`, { status })).data.data;
export const drawTombola = async (id: string): Promise<TombolaMonth> => (await apiClient.post(`/tombolas/admin/${id}/draw`)).data.data;

export const STATUS: Record<TombolaStatus, [string, Tone]> = {
    open: ['Ouverte', 'success'],
    drawing: ['Tirage en cours', 'warning'],
    closed: ['Clôturée', 'neutral'],
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthName = (m: number) => MONTHS[m - 1] ?? String(m);
export const periodLabel = (t: Pick<TombolaMonth, 'month' | 'year'>) => {
    const n = monthName(t.month);
    return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${t.year}`;
};
export const rankLabel = (r: number) => (r === 1 ? '1er prix' : `${r}e prix`);
