import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import {
    generateManualCode,
    submitManualVideo,
    getManualStatus,
    listPendingManualVerifications,
    approveManualVerification,
    rejectManualVerification,
    decideManualVerification,
    listForSupportSync,
    getProofForSupport,
    AlreadyDecidedError,
    SUPPORT_BAN_ROLES,
} from '../../services/manual-verification.service';
import { ManualVerificationStatus } from '../../database/models/manual-verification.model';
import config from '../../config';
import { AppError } from '../../utils/errors';
import { readAdminFilters, dateMatch } from '../../utils/admin-filters';
import { CountryFilterUnavailableError } from '../../utils/country-members';
import { diffuseurMatch } from '../../services/admin-scope.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ManualVerificationController');

const currentUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

const fail = (res: Response, err: unknown, context: string) => {
    if (err instanceof CountryFilterUnavailableError) {
        return res.status(502).json({ success: false, message: err.message });
    }
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}: ${(err as Error)?.message}`, { stack: (err as Error)?.stack });
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (err as Error).message,
    });
};

// --- Diffuseur ---

export const issueCode = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await generateManualCode(currentUserId(req), req.params.participationId);
        return res.status(201).json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'issueCode');
    }
};

export const uploadVideo = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await submitManualVideo(currentUserId(req), req.params.participationId, req.body?.videoFileId);
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'uploadVideo');
    }
};

export const manualStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await getManualStatus(currentUserId(req), req.params.participationId);
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'manualStatus');
    }
};

// --- Admin ---

/** Reads ?page/?limit. None given = the whole queue (older callers count it). */
const readPaging = (req: AuthenticatedRequest): { page: number; limit: number } | undefined => {
    const { page, limit } = req.query as Record<string, string | undefined>;
    if (page === undefined && limit === undefined) return undefined;
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const l = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    return { page: p, limit: l };
};

/**
 * Proof decisions belong to SBC Support (contract §2.3). While
 * VIDEO_VERIFICATION_ADMIN_READONLY is on (the default), the admin panel can
 * only decide as the super admin (role `admin`), and that override is logged.
 */
const adminDecisionGuard = (req: AuthenticatedRequest, res: Response, action: string): { override: boolean } | null => {
    if (!config.videoVerification.adminReadOnly) return { override: false };
    const role = req.user?.role;
    if (role !== 'admin') {
        log.warn(`Admin ${action} of proof ${req.params.id} refused: read-only, role ${role} (user ${req.user?.userId})`);
        res.status(403).json({
            success: false,
            code: 'ADMIN_READONLY',
            message: 'Les décisions se prennent dans l’espace SBC Support.',
        });
        return null;
    }
    log.warn(`SUPER ADMIN OVERRIDE: ${req.user?.userId} ${action} proof ${req.params.id} from the admin panel while it is read-only`);
    return { override: true };
};

const decisionFail = (res: Response, err: unknown, context: string) => {
    if (err instanceof AlreadyDecidedError) {
        return res.status(409).json({ success: false, code: err.code, message: err.message, data: { status: err.currentStatus } });
    }
    return fail(res, err, context);
};

/**
 * Admin filters: country = the DIFFUSEUR's; from/to on `uploadedAt` (when the
 * proof video was sent, which is also the queue's order). `data` stays the list
 * itself; `pagination` and `adminDecisions` sit beside it.
 */
export const listPending = async (req: AuthenticatedRequest, res: Response) => {
    const filters = readAdminFilters(req, res);
    if (!filters) return;
    try {
        const paging = readPaging(req);
        const { items, total } = await listPendingManualVerifications({
            ...await diffuseurMatch('diffuseurUserId', filters.country),
            ...dateMatch('uploadedAt', filters),
        }, paging);
        const limit = paging?.limit ?? Math.max(total, 1);
        const readOnly = config.videoVerification.adminReadOnly;
        return res.json({
            success: true,
            data: items,
            pagination: { page: paging?.page ?? 1, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
            adminDecisions: { readOnly, allowed: !readOnly || req.user?.role === 'admin' },
        });
    } catch (err) {
        return fail(res, err, 'listPending');
    }
};

export const approve = async (req: AuthenticatedRequest, res: Response) => {
    const guard = adminDecisionGuard(req, res, 'approve');
    if (!guard) return;
    try {
        const data = await approveManualVerification(
            currentUserId(req),
            req.params.id,
            Number(req.body?.observedViewCount),
            { role: req.user?.role, ...(guard.override ? { override: true } : {}) },
        );
        return res.json({ success: true, data });
    } catch (err) {
        return decisionFail(res, err, 'approveManualVerification');
    }
};

export const reject = async (req: AuthenticatedRequest, res: Response) => {
    const guard = adminDecisionGuard(req, res, 'reject');
    if (!guard) return;
    try {
        const data = await rejectManualVerification(
            currentUserId(req),
            req.params.id,
            req.body?.reason,
            req.body?.ban === true,
            { role: req.user?.role, ...(guard.override ? { override: true } : {}) },
        );
        return res.json({ success: true, data });
    } catch (err) {
        return decisionFail(res, err, 'rejectManualVerification');
    }
};

// --- SBC Support (internal, service secret) ---

const VALID_STATUSES = Object.values(ManualVerificationStatus) as string[];

/** Logs who is calling for which agent; the support side logs the same request id. */
const supportContext = (req: Request) => {
    const requestId = String(req.header('x-request-id') ?? '').slice(0, 100) || undefined;
    const actorHeader = String(req.header('x-support-actor') ?? '').slice(0, 200) || undefined;
    const service = String(req.header('x-service-name') ?? '').slice(0, 60) || 'unknown';
    return { requestId, actorHeader, service };
};

/** GET /advertising/internal/manual-verifications?status=pending_review&updatedSince&limit=200 */
export const internalList = async (req: Request, res: Response) => {
    const ctx = supportContext(req);
    try {
        const status = String(req.query.status ?? ManualVerificationStatus.PENDING_REVIEW);
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, code: 'INVALID_STATUS', message: `Statut inconnu : ${status}.` });
        }
        let updatedSince: Date | undefined;
        if (req.query.updatedSince !== undefined && req.query.updatedSince !== '') {
            updatedSince = new Date(String(req.query.updatedSince));
            if (Number.isNaN(updatedSince.getTime())) {
                return res.status(400).json({ success: false, code: 'INVALID_DATE', message: 'updatedSince invalide (ISO 8601).' });
            }
        }
        const limit = Math.min(500, Math.max(1, Math.floor(Number(req.query.limit) || 200)));
        const data = await listForSupportSync({ status: status as ManualVerificationStatus, updatedSince, limit });
        log.info(`[support] list ${status} since ${updatedSince?.toISOString() ?? '-'}: ${data.length} (from ${ctx.service}, request ${ctx.requestId ?? '-'})`);
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'internalList');
    }
};

/** GET /advertising/internal/manual-verifications/:id */
export const internalDetail = async (req: Request, res: Response) => {
    const ctx = supportContext(req);
    try {
        const data = await getProofForSupport(req.params.id);
        log.info(`[support] detail ${req.params.id} for ${ctx.actorHeader ?? '-'} (request ${ctx.requestId ?? '-'})`);
        if (!data) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Vérification introuvable.' });
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'internalDetail');
    }
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** POST /advertising/internal/manual-verifications/:id/decision */
export const internalDecision = async (req: Request, res: Response) => {
    const ctx = supportContext(req);
    const body = req.body ?? {};
    const actor = {
        agentId: str(body.actor?.agentId, 100),
        name: str(body.actor?.name, 200),
        role: str(body.actor?.role, 60),
    };
    if (!actor.agentId || !actor.role) {
        return res.status(400).json({ success: false, code: 'ACTOR_REQUIRED', message: 'actor.agentId et actor.role sont obligatoires.' });
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
        return res.status(400).json({ success: false, code: 'INVALID_DECISION', message: 'Décision invalide : « approve » ou « reject ».' });
    }
    let ban = body.ban === true && body.decision === 'reject';
    if (ban && !SUPPORT_BAN_ROLES.includes(actor.role)) {
        // Not an error: the proof is still rejected, the ban is not applied.
        log.warn(`[support] ban requested by ${actor.agentId} (${actor.role}) on proof ${req.params.id} ignored: role cannot ban (request ${ctx.requestId ?? '-'})`);
        ban = false;
    }
    try {
        const data = await decideManualVerification(req.params.id, {
            decision: body.decision,
            observedViewCount: body.observedViews === undefined || body.observedViews === null ? undefined : Number(body.observedViews),
            reason: typeof body.reason === 'string' ? body.reason : undefined,
            ban,
            actor: { source: 'support', id: actor.agentId, name: actor.name || undefined, role: actor.role, requestId: ctx.requestId },
        });
        log.info(`[support] decision ${body.decision} on ${req.params.id} by ${actor.agentId} (${actor.role}), header actor ${ctx.actorHeader ?? '-'}, request ${ctx.requestId ?? '-'}`);
        return res.json({ success: true, data: { ...data, banIgnored: body.ban === true && !ban && body.decision === 'reject' } });
    } catch (err) {
        return decisionFail(res, err, 'internalDecision');
    }
};
