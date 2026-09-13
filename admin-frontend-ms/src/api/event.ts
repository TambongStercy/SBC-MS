import apiClient from './apiClient';

/**
 * SBC Event — admin API.
 *
 * Talks to event-service through the gateway at /api/tickets. All of these
 * require an admin role; the service rejects anything else with a 403.
 * (URL prefix is /tickets, not /events, because /api/events was already
 * owned by settings-service's community-events feature; product brand is
 * "SBC Event".)
 */

export type OrganizerStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED';
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'CANCELLED' | 'COMPLETED';

export interface AdminOrganizer {
    _id: string;
    userId: string;
    displayName: string;
    contactEmail?: string;
    contactPhone?: string;
    bio?: string;
    status: OrganizerStatus;
    approvedAt?: string;
    suspendedAt?: string;
    stats?: { eventsPublished: number; ticketsSold: number; grossRevenue: number };
    createdAt: string;
}

export interface AdminEvent {
    _id: string;
    slug: string;
    organizerId: string;
    title: string;
    status: EventStatus;
    startsAt: string;
    endsAt: string;
    city: string;
    venue: string;
    totals?: { ticketsSold: number; grossRevenue: number; checkedIn: number };
    createdAt: string;
}

export async function getEventDashboard() {
    const { data } = await apiClient.get('/tickets/admin/dashboard');
    return data.data;
}

export async function listOrganizers(params: { status?: OrganizerStatus; limit?: number; skip?: number } = {}) {
    const { data } = await apiClient.get('/tickets/admin/organizers', { params });
    return data.data as { items: AdminOrganizer[]; total: number };
}

export async function approveOrganizer(organizerId: string) {
    const { data } = await apiClient.post(`/tickets/admin/organizers/${organizerId}/approve`);
    return data.data as AdminOrganizer;
}

export async function suspendOrganizer(organizerId: string, reason?: string) {
    const { data } = await apiClient.post(`/tickets/admin/organizers/${organizerId}/suspend`, { reason });
    return data.data as AdminOrganizer;
}

export async function listAdminEvents(params: { status?: EventStatus; organizerId?: string; limit?: number; skip?: number } = {}) {
    const { data } = await apiClient.get('/tickets/admin/events', { params });
    return data.data as { items: AdminEvent[]; total: number };
}

export async function getAdminEvent(eventId: string) {
    const { data } = await apiClient.get(`/tickets/admin/events/${eventId}`);
    return data.data as AdminEvent;
}

export async function suspendAdminEvent(eventId: string) {
    const { data } = await apiClient.post(`/tickets/admin/events/${eventId}/suspend`);
    return data.data as AdminEvent;
}

export async function cancelAdminEvent(eventId: string, reason?: string) {
    const { data } = await apiClient.post(`/tickets/admin/events/${eventId}/cancel`, { reason });
    return data.data as AdminEvent;
}

export async function refundOrder(orderId: string) {
    const { data } = await apiClient.post(`/tickets/admin/orders/${orderId}/refund`);
    return data.data;
}

export function apiErrorMessage(err: any, fallback: string): string {
    return err?.response?.data?.message || fallback;
}
