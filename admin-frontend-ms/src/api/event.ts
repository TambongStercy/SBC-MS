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

export async function refundOrder(orderId: string, reason?: string) {
    const { data } = await apiClient.post(`/tickets/admin/orders/${orderId}/refund`, { reason });
    return data.data;
}

// ---- orders / tickets ----

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type OrderKind = 'PRIMARY' | 'RESALE';

export interface AdminOrder {
    _id: string;
    userId: string;
    eventId: string;
    kind: OrderKind;
    status: OrderStatus;
    subtotal: number;
    commission: number;
    total: number;
    holder: { firstName: string; lastName: string; phone: string; email?: string };
    paymentSessionId?: string;
    paidAt?: string;
    createdAt: string;
}

export async function listAdminOrders(params: {
    status?: OrderStatus; kind?: OrderKind; eventId?: string; userId?: string; limit?: number; skip?: number;
} = {}) {
    const { data } = await apiClient.get('/tickets/admin/orders', { params });
    return data.data as { items: AdminOrder[]; total: number };
}

export type TicketStatus = 'PENDING' | 'ISSUED' | 'CHECKED_IN' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';

export interface AdminTicket {
    _id: string;
    serial: string;
    orderId: string;
    eventId: string;
    status: TicketStatus;
    holderName: string;
    holderPhone: string;
    holderEmail?: string;
    issuedAt?: string;
    checkedInAt?: string;
    previousTicketId?: string;
    createdAt: string;
}

export async function listAdminTickets(params: {
    status?: TicketStatus; eventId?: string; serial?: string; q?: string; limit?: number; skip?: number;
} = {}) {
    const { data } = await apiClient.get('/tickets/admin/tickets', { params });
    return data.data as { items: AdminTicket[]; total: number };
}

// ---- resale listings ----

export type ResaleListingStatus = 'DRAFT' | 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';

export interface AdminResaleListing {
    _id: string;
    ticketId: string;
    sellerUserId: string;
    eventId: string;
    originalPrice: number;
    askingPrice: number;
    status: ResaleListingStatus;
    listedAt: string;
    soldAt?: string;
    cancelledAt?: string;
}

export async function listAdminResaleListings(params: {
    status?: ResaleListingStatus; eventId?: string; limit?: number; skip?: number;
} = {}) {
    const { data } = await apiClient.get('/tickets/admin/resale-listings', { params });
    return data.data as { items: AdminResaleListing[]; total: number };
}

export async function suspendResaleListing(listingId: string) {
    const { data } = await apiClient.post(`/tickets/admin/resale-listings/${listingId}/suspend`);
    return data.data;
}

export async function removeResaleListing(listingId: string) {
    const { data } = await apiClient.delete(`/tickets/admin/resale-listings/${listingId}`);
    return data.data;
}

// ---- disputes ----

export type DisputeStatus = 'OPEN' | 'RESOLVED' | 'REJECTED';

export interface AdminDispute {
    _id: string;
    kind: string;
    complainantUserId: string;
    resaleOrderId?: string;
    ticketId?: string;
    eventId?: string;
    description: string;
    status: DisputeStatus;
    resolutionNote?: string;
    resolvedAt?: string;
    createdAt: string;
}

export async function listAdminDisputes(params: { status?: DisputeStatus; limit?: number; skip?: number } = {}) {
    const { data } = await apiClient.get('/tickets/admin/disputes', { params });
    return data.data as { items: AdminDispute[]; total: number };
}

export async function resolveDispute(disputeId: string, note: string, outcome: 'resolve' | 'reject' = 'resolve') {
    const { data } = await apiClient.post(`/tickets/admin/disputes/${disputeId}/resolve`, { note, outcome });
    return data.data as AdminDispute;
}

// ---- commission config ----

export async function getEventCommissionConfig() {
    const { data } = await apiClient.get('/tickets/admin/commission-config');
    return data.data as { primaryPct: number; resalePct: number; defaultMaxResalePricePct: number };
}

export async function bustEventCommissionConfigCache() {
    const { data } = await apiClient.patch('/tickets/admin/commission-config');
    return data.data;
}

export function apiErrorMessage(err: any, fallback: string): string {
    return err?.response?.data?.message || fallback;
}
