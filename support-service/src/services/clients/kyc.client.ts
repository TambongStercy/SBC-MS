import crypto from 'crypto';
import config from '../../config';
import { AppError, DependencyError, badRequest, conflict, tooMany } from '../../utils/errors';
import logger from '../../utils/logger';

/**
 * kyc-worker on the secondary server, KYC level 3 (ID document + selfie, 2026-11-22).
 * Every request is signed like risk-service's: X-KYC-Timestamp + X-KYC-Signature =
 * hex HMAC-SHA256(KYC_SHARED_SECRET, "<ts>.<raw body>"). The images live there only
 * (encrypted); this service keeps the request's id, status and the decision.
 */
const log = logger.getLogger('KycClient');

export const KYC_PURPOSES = ['fraud_hold', 'authenticator_reset', 'lost_access'] as const;
export type KycPurpose = typeof KYC_PURPOSES[number];
export const KYC_KINDS = ['id_front', 'id_back', 'selfie'] as const;
export type KycKind = typeof KYC_KINDS[number];

export interface KycL3Scores {
    version?: number; engine?: string;
    images?: Record<string, { readable: boolean; width?: number; height?: number; sharpness?: number; brightness?: number; faces?: number }>;
    match?: { score: number; same: boolean; threshold: number } | null;
    sameImageOtherPeople?: number;
    sameFaceOtherPeople?: { request: string; ref: string; score: number }[];
    hints?: string[];
}
export interface KycL3Request {
    id: string; ref: string; purpose: KycPurpose; status: 'pending' | 'checked' | 'approved' | 'refused';
    createdAt: string | null; checkedAt: string | null; scores: KycL3Scores | null;
    decidedAt: string | null; decidedBy: string | null; decisionReason: string | null;
    imagesDeleteAt: string | null; imagesDeletedAt: string | null; images: KycKind[];
}

export const kycConnected = () => Boolean(config.kyc.url && config.kyc.secret);

async function call(path: string, body: unknown, timeoutMs = config.kyc.timeoutMs): Promise<Response> {
    if (!kycConnected()) throw new AppError(503, 'La vérification d’identité n’est pas encore ouverte.', 'KYC_NOT_CONNECTED');
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', config.kyc.secret).update(`${ts}.${raw}`).digest('hex');
    let res: Response;
    try {
        res = await fetch(`${config.kyc.url}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-KYC-Timestamp': ts, 'X-KYC-Signature': sig },
            body: raw,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (err) {
        log.warn('kyc-worker unreachable', { path, message: (err as Error).message });
        throw new DependencyError('kyc');
    }
    if (res.status >= 500 || res.status === 401) {
        // 401 = the two secrets differ: an outage for the member, a configuration error for us.
        log.warn(`kyc-worker answered ${res.status}`, { path });
        throw new DependencyError('kyc', res.status);
    }
    return res;
}

async function json<T>(res: Response): Promise<T> {
    try { return await res.json() as T; } catch { throw new DependencyError('kyc', res.status); }
}

export async function submitL3(input: { ref: string; purpose: KycPurpose; images: Partial<Record<KycKind, Buffer>> }): Promise<string> {
    const images: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.images)) if (v) images[k] = v.toString('base64');
    const res = await call('/v1/l3/submit', { ref: input.ref, purpose: input.purpose, images }, 60_000);
    if (res.status === 409) throw conflict('Une vérification d’identité est déjà en cours. Attendez la réponse de l’équipe.', 'IDENTITY_PENDING');
    if (res.status === 429) throw tooMany('Vous avez envoyé plusieurs vérifications aujourd’hui. Réessayez demain.');
    if (res.status === 413) throw badRequest('Une photo est trop lourde (4 Mo au plus).', 'IMAGE_TOO_LARGE');
    if (res.status === 400) throw badRequest('Envoyez des photos JPEG, PNG ou WebP : le recto de la pièce et un selfie.', 'BAD_IMAGES');
    if (!res.ok) throw new DependencyError('kyc', res.status);
    return (await json<{ id: string }>(res)).id;
}

export async function getL3(ids: string[]): Promise<Record<string, KycL3Request>> {
    if (!ids.length) return {};
    const out: Record<string, KycL3Request> = {};
    for (let i = 0; i < ids.length; i += 100) {
        const res = await call('/v1/l3/get', { ids: ids.slice(i, i + 100) }, 8000);
        if (!res.ok) throw new DependencyError('kyc', res.status);
        Object.assign(out, (await json<{ items: Record<string, KycL3Request> }>(res)).items);
    }
    return out;
}

export async function imageL3(id: string, kind: KycKind): Promise<{ data: Buffer; mime: string } | null> {
    const res = await call('/v1/l3/image', { id, kind }, 15_000);
    if (res.status === 404) return null;
    if (!res.ok) throw new DependencyError('kyc', res.status);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'application/octet-stream' };
}

/** null when it was already decided there. */
export async function decideL3(input: { id: string; decision: 'approved' | 'refused'; by: string; reason: string }): Promise<KycL3Request | null> {
    const res = await call('/v1/l3/decide', input, 8000);
    if (res.status === 409) return null;
    if (!res.ok) throw new DependencyError('kyc', res.status);
    return json<KycL3Request>(res);
}
