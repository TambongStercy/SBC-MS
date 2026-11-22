import { api, request } from './http';

/** KYC level 3: ID document + selfie sent by a member or a person who lost access (2026-11-22). */
export type IdentityStatus = 'pending' | 'checked' | 'approved' | 'refused';
export type IdentityPurpose = 'fraud_hold' | 'authenticator_reset' | 'lost_access';
export type IdentityImageKind = 'id_front' | 'id_back' | 'selfie';

export interface IdentityRow {
  id: string;
  memberId: string | null;
  ticketId: string | null;
  purpose: IdentityPurpose;
  purposeLabel: string;
  status: IdentityStatus;
  country: string | null;
  name: string | null;
  guest: boolean;
  images: IdentityImageKind[];
  matchScore: number | null;
  hints: { code: string; text: string }[];
  submittedAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; name: string } | null;
  decisionReason: string | null;
  imagesDeletedAt: string | null;
}

export interface IdentityDetail extends IdentityRow {
  checks: {
    engine: string | null;
    match: { score: number; same: boolean; threshold: number } | null;
    images: Record<string, { readable: boolean; sharpness?: number; brightness?: number; faces?: number }>;
    sameImageOtherPeople: number;
    sameFaceOtherPeople: { score: number; memberId: string | null; guest: boolean }[];
  } | null;
  imagesDeleteAt: string | null;
}

export const identityApi = {
  list: (status: 'open' | 'approved' | 'refused' | 'all') => api.get<IdentityRow[]>('/identity', { status }),
  get: (id: string) => api.get<IdentityDetail>(`/identity/${encodeURIComponent(id)}`),
  /** The image as a blob (the session refresh applies; never cached). */
  image: async (id: string, kind: IdentityImageKind): Promise<Blob> => {
    const res = await request<Response>('GET', `/identity/${encodeURIComponent(id)}/images/${kind}`, { raw: true });
    return res.blob();
  },
  decide: (id: string, decision: 'approved' | 'refused', reason: string, reauthToken: string) =>
    api.post<IdentityDetail>(`/identity/${encodeURIComponent(id)}/decision`, { decision, reason }, { reauthToken }),
};
