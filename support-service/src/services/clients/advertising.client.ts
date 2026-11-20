import { serviceRequest, requireOk, isRouteMissing } from './http';
import { DependencyError } from '../../utils/errors';

/** advertising-service internal API (CONTRACT §2.3). */

export interface PendingProof { id?: string; _id?: string; submittedAt: string; campaignId?: string; diffuseurUserId?: string; dayIndex?: number; country?: string }

const BASE = '/api/advertising/internal/manual-verifications';

export async function listPendingProofs(updatedSince?: string, limit = 200): Promise<PendingProof[]> {
    const r = await serviceRequest<PendingProof[] | { items: PendingProof[] }>('advertising', 'GET', BASE, { query: { status: 'pending_review', updatedSince, limit } });
    const data = requireOk('advertising', r) as any;
    return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function getProof(id: string): Promise<unknown> {
    const r = await serviceRequest('advertising', 'GET', `${BASE}/${encodeURIComponent(id)}`);
    if (r.status === 404 && !isRouteMissing(r)) return null;
    return requireOk('advertising', r);
}

export interface DecisionResult { ok: boolean; alreadyDecided: boolean; status: number; code?: string; message?: string }

export async function decideProof(id: string, body: {
    decision: 'approve' | 'reject'; observedViews?: number; reason?: string; ban?: boolean;
    actor: { agentId: string; name: string; role: string };
}): Promise<DecisionResult> {
    const r = await serviceRequest('advertising', 'POST', `${BASE}/${encodeURIComponent(id)}/decision`, { body });
    if (isRouteMissing(r)) throw new DependencyError('advertising', 404);
    return { ok: r.ok, alreadyDecided: r.status === 409 && r.code === 'ALREADY_DECIDED', status: r.status, code: r.code, message: r.message };
}
