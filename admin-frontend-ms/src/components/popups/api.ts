import apiClient from '../../api/apiClient';
import { fileProxyUrl } from '../../services/impactChallengeApi';
import { countryName } from '../../lib/countries';
import { fmtInt } from '../display/format';

/** Who a pop-up announcement is for. Empty = every member. Same shape as the server's AnnouncementTargeting. */
export interface Targeting {
    countries?: string[];
    subscription?: 'subscribed' | 'unsubscribed';
    sex?: 'male' | 'female';
    interests?: string[];
    professions?: string[];
    ageMin?: number;
    ageMax?: number;
}

export type PopupStatus = 'active' | 'paused' | 'ended';
/** status + dates, worked out by the server. */
export type PopupState = 'live' | 'scheduled' | 'expired' | 'paused' | 'ended';

export interface PopupAnnouncement {
    id: string;
    title: string;
    message: string;
    imageUrl?: string;
    buttonLabel?: string;
    buttonUrl?: string;
    filter?: Targeting;
    audience: number;
    status: PopupStatus;
    state: PopupState;
    startsAt: string;
    endsAt?: string;
    stats: { shown: number; closed: number; clicked: number };
    createdAt: string;
}

export interface PopupList { items: PopupAnnouncement[]; total: number; page: number; limit: number; live: number }
export interface TargetingOption { value: string; count: number }
export interface TargetingOptions { interests: TargetingOption[]; professions: TargetingOption[] }

export interface PopupInput {
    title: string;
    message: string;
    imageUrl?: string;
    buttonLabel?: string;
    buttonUrl?: string;
    startsAt?: string;
    endsAt?: string | null;
    filter: Targeting;
    status?: PopupStatus;
}

const BASE = '/notifications/announcements/admin';

export const popupApi = {
    list: async (params: Record<string, unknown>) => (await apiClient.get(BASE, { params })).data.data as PopupList,
    options: async () => (await apiClient.get(`${BASE}/options`)).data.data as TargetingOptions,
    audience: async (filter: Targeting) => (await apiClient.post(`${BASE}/audience`, { filter })).data.data.count as number,
    create: async (input: PopupInput) => (await apiClient.post(BASE, input)).data.data as PopupAnnouncement,
    update: async (id: string, input: Partial<PopupInput>) => (await apiClient.patch(`${BASE}/${id}`, input)).data.data as PopupAnnouncement,
    remove: async (id: string) => { await apiClient.delete(`${BASE}/${id}`); },
    /** Uploads an image through settings-service; returns the link members' phones load. */
    uploadImage: async (file: File, onProgress?: (percent: number) => void): Promise<string> => {
        const form = new FormData();
        form.append('file', file);
        const { data } = await apiClient.post('/settings/files/upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 5 * 60 * 1000,
            onUploadProgress: e => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
        });
        const fileId: string | undefined = data?.data?.fileId;
        if (!fileId) throw new Error('L’image n’a pas pu être envoyée.');
        return fileProxyUrl(fileId);
    },
};

export const SUBSCRIPTION_LABEL = { subscribed: 'Abonnés', unsubscribed: 'Non abonnés' } as const;
export const SEX_LABEL = { male: 'Hommes', female: 'Femmes' } as const;

export const membres = (n: number) => `${fmtInt(n)} membre${n > 1 ? 's' : ''}`;

const listOf = (values: string[], max = 2) =>
    values.length <= max ? values.join(', ') : `${values.slice(0, max).join(', ')} +${values.length - max}`;

/** "Cameroun, Sénégal · 18–35 ans · Football +2" — or "Tout le monde". */
export function describeTargeting(f?: Targeting | null): string {
    if (!f) return 'Tout le monde';
    const age = f.ageMin !== undefined && f.ageMax !== undefined ? `${f.ageMin}–${f.ageMax} ans`
        : f.ageMin !== undefined ? `${f.ageMin} ans et plus`
            : f.ageMax !== undefined ? `${f.ageMax} ans au plus` : '';
    const parts = [
        f.countries?.length ? listOf(f.countries.map(c => countryName(c))) : '',
        age,
        f.sex ? SEX_LABEL[f.sex] : '',
        f.subscription ? SUBSCRIPTION_LABEL[f.subscription] : '',
        f.interests?.length ? `Intérêts : ${listOf(f.interests)}` : '',
        f.professions?.length ? `Métiers : ${listOf(f.professions)}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Tout le monde';
}

export const isEmptyTargeting = (f: Targeting) => Object.keys(f).length === 0;
