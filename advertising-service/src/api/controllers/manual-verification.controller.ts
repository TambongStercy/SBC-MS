import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import {
    generateManualCode,
    submitManualVideo,
    getManualStatus,
    listPendingManualVerifications,
    approveManualVerification,
    rejectManualVerification,
} from '../../services/manual-verification.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('ManualVerificationController');

const currentUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

const fail = (res: Response, err: unknown, context: string) => {
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

export const listPending = async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await listPendingManualVerifications();
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'listPending');
    }
};

export const approve = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await approveManualVerification(
            currentUserId(req),
            req.params.id,
            Number(req.body?.observedViewCount),
        );
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'approveManualVerification');
    }
};

export const reject = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = await rejectManualVerification(
            currentUserId(req),
            req.params.id,
            req.body?.reason,
            req.body?.ban === true,
        );
        return res.json({ success: true, data });
    } catch (err) {
        return fail(res, err, 'rejectManualVerification');
    }
};
