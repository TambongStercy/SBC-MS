import apiClient from '../../../api/apiClient';
import type { Tone } from '../../../ui';
import { formatNumber } from '../../../lib/format';

/**
 * Relance, as notification-service serves it to admins (`/api/relance/admin/*`).
 * Two products share the name and are always kept apart here:
 *  - relance des nouveaux: targets with no campaign; a new filleul who hasn't paid
 *    gets one message a day for 7 days;
 *  - campagnes de relance: a parrain picks older filleuls and runs them through
 *    the same 7 days.
 */

export interface Person { _id: string; name: string; phoneNumber?: string; email?: string }

// ---- overview ----

type Sends = { email: number; sms: number; failed: number };
type Sales = { count: number; amountXAF: number };
export interface Overview {
    nouveaux: { active: number; enrolledToday: number; paidLast30Days: number; finishedLast30Days: number };
    campaigns: { byStatus: Partial<Record<CampaignStatus, number>>; activeTargets: number };
    sends: { today: Sends; last7Days: Sends };
    credits: { emailLeft: number; smsLeft: number; parrainsWithCredits: number };
    packs: { total: Sales; last30Days: Sales };
}
export const getOverview = async (): Promise<Overview> => (await apiClient.get('/relance/admin/overview')).data.data;

// ---- campaigns ----

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
export interface Campaign {
    _id: string;
    userId: string;
    owner: Person | null;
    name: string;
    status: CampaignStatus;
    channel?: 'email' | 'sms' | 'both';
    targetFilter?: {
        countries?: string[];
        registrationDateFrom?: string;
        registrationDateTo?: string;
        subscriptionStatus?: 'subscribed' | 'non-subscribed' | 'all';
        gender?: 'male' | 'female' | 'other' | 'all';
        professions?: string[];
        minAge?: number;
        maxAge?: number;
        maxTargets?: number;
    };
    customMessages?: Array<{ dayNumber: number }>;
    targetsEnrolled: number;
    targetsConverted?: number;
    messagesSent: number;
    scheduledStartDate?: string;
    actualStartDate?: string;
    actualEndDate?: string;
    pausedAt?: string;
    cancelledAt?: string;
    cancelReason?: string;
    createdAt: string;
}
export const listCampaigns = async (p: { status?: string; userId?: string; page: number; limit: number }):
    Promise<{ campaigns: Campaign[]; total: number; page: number; totalPages: number }> =>
    (await apiClient.get('/relance/admin/campaigns', { params: { ...p, status: p.status || undefined, userId: p.userId || undefined } })).data.data;

export interface CampaignStats {
    totalEnrolled: number;
    activeTargets: number;
    completedRelance: number;
    targetsConverted: number;
    targetsExited: number;
    totalMessagesSent: number;
    totalMessagesDelivered: number;
    totalMessagesFailed: number;
    deliveryPercentage: number;
    openRate: number;
    clickRate: number;
    dayProgression: Array<{ day: number; count: number }>;
}
export const getCampaignStats = async (id: string): Promise<CampaignStats> =>
    (await apiClient.get(`/relance/admin/campaigns/${id}/stats`)).data.data;

export type TargetStatus = 'active' | 'completed' | 'paused';
export type ExitReason = 'paid' | 'completed_7days' | 'manual' | 'referrer_inactive' | 'email_suppressed' | 'expired';
export interface Delivery { day: number; channel?: 'email' | 'sms'; sentAt: string; status: 'delivered' | 'failed'; errorMessage?: string; opened?: boolean; clicked?: boolean }
export interface Target {
    _id: string;
    referralUserId: string;
    referralUser: Person | null;
    currentDay: number;
    status: TargetStatus;
    exitReason?: ExitReason;
    enteredLoopAt: string;
    exitedLoopAt?: string;
    messagesDelivered: Delivery[];
}
export const listCampaignTargets = async (id: string, page: number, limit: number):
    Promise<{ targets: Target[]; pagination: { page: number; limit: number; total: number; pages: number } }> =>
    (await apiClient.get(`/relance/admin/campaigns/${id}/targets`, { params: { page, limit } })).data.data;

export interface RecentMessage {
    day: number;
    sentAt: string;
    status: 'delivered' | 'failed';
    errorMessage?: string;
    referralUser: { _id: string; name: string; email?: string; phoneNumber?: string; avatar?: string } | null;
}
export const getCampaignRecent = async (id: string, limit = 20): Promise<{ messages: RecentMessage[]; total: number }> =>
    (await apiClient.get(`/relance/admin/campaigns/${id}/messages/recent`, { params: { limit } })).data.data;

export const pauseCampaign = (id: string) => apiClient.post(`/relance/admin/campaigns/${id}/pause`);
export const resumeCampaign = (id: string) => apiClient.post(`/relance/admin/campaigns/${id}/resume`);
export const cancelCampaign = (id: string, reason: string) => apiClient.post(`/relance/admin/campaigns/${id}/cancel`, { reason });

// ---- parrains ----

export interface Parrain {
    userId: string;
    user: Person | null;
    enabled: boolean;
    enrollmentPaused: boolean;
    sendingPaused: boolean;
    smsEnabled: boolean;
    emailBalance: number;
    smsBalance: number;
    emailsSentToday: number;
    maxMessagesPerDay: number;
    inLoop: { nouveaux: number; campaigns: number };
    packs: { count: number; lastAt: string | null };
}
export const listParrains = async (p: { withCredits: boolean; userId?: string; page: number; limit: number }):
    Promise<{ parrains: Parrain[]; total: number; page: number; totalPages: number }> =>
    (await apiClient.get('/relance/admin/parrains', { params: { ...p, withCredits: String(p.withCredits), userId: p.userId || undefined } })).data.data;

export const updateParrain = (userId: string, data: Partial<Pick<Parrain, 'sendingPaused' | 'enrollmentPaused' | 'maxMessagesPerDay'>>) =>
    apiClient.put(`/relance/admin/configs/${userId}`, data);

// ---- the 7 SBC emails ----

export interface EmailButton { label: string; url: string; color?: string }
export interface EmailDay {
    _id?: string;
    dayNumber: number;
    subject?: string;
    messageTemplate: { fr: string; en: string };
    mediaUrls: Array<{ url: string; type: 'image' | 'video' | 'pdf'; filename?: string }>;
    buttons: EmailButton[];
    active: boolean;
    updatedAt?: string;
}
export const listEmailDays = async (): Promise<EmailDay[]> => (await apiClient.get('/relance/admin/messages')).data.data;
export const saveEmailDay = (d: Omit<EmailDay, '_id' | 'updatedAt'>) => apiClient.post('/relance/admin/messages', d);
export const previewEmailDay = async (d: Pick<EmailDay, 'dayNumber' | 'subject' | 'messageTemplate' | 'mediaUrls' | 'buttons'>): Promise<string> =>
    (await apiClient.post('/relance/admin/messages/preview', { ...d, recipientName: 'Aïcha', referrerName: 'Paul' })).data.data.html;

// ---- SMS ----

export type SmsKind = 'auto' | 'manual';
export interface SmsTemplate { _id: string; type: SmsKind; dayNumber: number; templateText: string; active: boolean }
export const listSms = async (): Promise<SmsTemplate[]> => (await apiClient.get('/relance/admin/sms-templates')).data.data;
export const saveSms = (t: Pick<SmsTemplate, 'type' | 'dayNumber'>, data: { templateText?: string; active?: boolean }) =>
    apiClient.put(`/relance/admin/sms-templates/${t.type}/${t.dayNumber}`, data);

// ---- labels ----

export const CAMPAIGN_STATUS: Record<CampaignStatus, [string, Tone]> = {
    draft: ['Brouillon', 'neutral'],
    scheduled: ['Programmée', 'primary'],
    active: ['En cours', 'success'],
    paused: ['En pause', 'warning'],
    completed: ['Terminée', 'neutral'],
    cancelled: ['Annulée', 'danger'],
};

export const EXIT_REASON: Record<ExitReason, [string, Tone]> = {
    paid: ['A payé', 'success'],
    completed_7days: ['7 jours finis', 'neutral'],
    manual: ['Retiré', 'neutral'],
    referrer_inactive: ['Parrain inactif', 'warning'],
    email_suppressed: ['E-mail invalide', 'danger'],
    expired: ['Trop ancien', 'neutral'],
};

export const DELIVERY: Record<string, [string, Tone]> = { delivered: ['Envoyé', 'success'], failed: ['Échec', 'danger'] };

export const CHANNEL: Record<string, string> = { email: 'E-mail', sms: 'SMS', both: 'E-mail et SMS' };

/** "1 pack", "3 packs". */
export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n > 1 ? many : one}`;
