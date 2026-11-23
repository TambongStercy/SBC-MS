import { NextFunction, Request, Response } from 'express';
import { adminStepUp } from '../../services/clients/user.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('ImpactStepUp');

/**
 * The admin's own authenticator code before an action that moves money or
 * fixes the result (refund a vote purchase, set the TOP 3). Same contract as
 * payment-service's requireAdminStepUp: the code travels in the body
 * (`adminCode` or `adminBackupCode`) and is removed before the handler; one
 * code opens a 10-minute window on the admin session; the admin app's
 * interceptor asks for it on ADMIN_CODE_REQUIRED and resends the request.
 * Fails closed (user-service down → 503). ADMIN_STEPUP_REQUIRED=false turns it off.
 */
const required = () => String(process.env.ADMIN_STEPUP_REQUIRED ?? 'true').toLowerCase() !== 'false';

export const requireAdminStepUp = (action: string) => async (req: Request, res: Response, next: NextFunction) => {
    const body: any = req.body && typeof req.body === 'object' ? req.body : {};
    const code = typeof body.adminCode === 'string' ? body.adminCode : undefined;
    const backupCode = typeof body.adminBackupCode === 'string' ? body.adminBackupCode : undefined;
    delete body.adminCode;
    delete body.adminBackupCode;
    if (!required()) return next();

    const user: any = (req as any).user ?? {};
    const userId = String(user.userId || user.id || '');
    const sid = String(user.asid || '');
    if (!userId || !sid) {
        return res.status(403).json({ success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Connectez-vous à l’administration et confirmez avec votre code d’authentification.' });
    }
    try {
        await adminStepUp({
            userId, sid, code, backupCode, action,
            ip: String(req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.ip || '').slice(0, 64),
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        });
        return next();
    } catch (e: any) {
        const status = Number(e?.statusCode) || 503;
        if (status === 401 || status === 403) log.warn(`Admin ${userId} ${action} refused: ${e?.code ?? status}.`);
        return res.status(status).json({ success: false, code: e?.code, message: e?.message || 'Code requis.' });
    }
};
