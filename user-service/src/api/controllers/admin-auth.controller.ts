import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import UserModel, { ADMIN_CAPABLE_ROLES, UserRole } from '../../database/models/user.model';
import * as adminAuth from '../../services/admin-auth.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

const log = logger.getLogger('AdminAuthController');

const ctxOf = (req: Request): adminAuth.ReqCtx => ({ ip: req.ip || 'unknown', userAgent: String(req.headers['user-agent'] || '') });

const fail = (res: Response, err: any) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, message: err.message });
        return;
    }
    log.error('Admin sign-in error', err);
    res.status(500).json({ success: false, message: 'La connexion a échoué. Réessayez.' });
};

const run = (fn: (req: AuthenticatedRequest) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
        res.status(200).json({ success: true, data: await fn(req as AuthenticatedRequest) });
    } catch (err) {
        fail(res, err);
    }
};

/** The admin session id carried by the token (absent on member-app tokens). */
export const sessionIdOf = (req: AuthenticatedRequest): string => String((req.user as any)?.asid || '');

/**
 * Admin sign-in (password → authenticator app), sessions and the
 * authenticator's management. See services/admin-auth.service.ts.
 */
export const adminAuthController = {
    login: run(req => adminAuth.login(req.body || {}, ctxOf(req))),
    verifyEmailCode: run(req => adminAuth.verifyEmailCode(req.body || {}, ctxOf(req))),
    enrollStart: run(req => adminAuth.enrollStart(req.body || {})),
    enrollConfirm: run(req => adminAuth.enrollConfirm(req.body || {}, ctxOf(req))),
    completeTotp: run(req => adminAuth.completeTotp(req.body || {}, ctxOf(req))),

    logout: run(async req => {
        const sid = sessionIdOf(req);
        if (sid) await adminAuth.revokeSession(sid, 'logout');
        return { ok: true };
    }),

    /** This admin's own security state (authenticator, backup codes left). */
    mySecurity: run(async req => {
        const id = String(req.user?.userId || '');
        return (await adminAuth.securityStatus([id]))[id];
    }),

    regenerateBackupCodes: run(async req => ({
        backupCodes: await adminAuth.regenerateBackupCodes(String(req.user?.userId || ''), req.body?.code),
    })),

    /** Super admin: lost phone. Not on one's own account (one's backup codes are for that). */
    resetAuthenticator: run(async req => {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) throw new AppError('Identifiant invalide.', 400);
        if (userId === String(req.user?.userId)) throw new AppError('Utilisez vos codes de secours, ou demandez à un autre super admin.', 409);
        const target = await UserModel.findById(userId).select('role email').lean();
        if (!target || !ADMIN_CAPABLE_ROLES.includes(target.role as UserRole)) throw new AppError('Ce compte n’a pas accès à l’administration.', 404);
        log.warn(`Authenticator reset for ${target.email} by ${req.user?.email}`);
        return adminAuth.resetAuthenticator(userId, String(req.user?.userId));
    }),
};

/**
 * Every admin route in user-service: the token must come from the admin
 * sign-in (it carries `asid`) and that session must still be open. The gateway
 * checks the same on every admin call; this is the same rule for a request
 * that reaches user-service directly.
 */
export const requireAdminSession = async (req: AuthenticatedRequest, res: Response, next: () => void) => {
    const sid = sessionIdOf(req);
    const state = sid ? await adminAuth.checkSession(String(req.user?.userId || ''), sid).catch(() => 'missing' as const) : 'missing';
    if (state !== 'active') {
        res.status(401).json({ success: false, code: 'ADMIN_SESSION_ENDED', message: 'Votre session d’administration est terminée. Reconnectez-vous.' });
        return;
    }
    next();
};
