import { NextFunction, Response } from 'express';
import { stepUp } from '../../services/admin-auth.service';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminStepUp');

/**
 * Security plan Phase 3 item 6, user-service side: admin actions that create or move a member's
 * money (balance adjustment, reversal of an activation transfer) need the admin's OWN
 * authenticator code, like payment-service's money routes. The code travels in the body
 * (`adminCode` / `adminBackupCode`), is removed before the handler, and opens the same
 * 10-minute window on the admin session (`adminsessions.stepUpUntil`).
 * ADMIN_STEPUP_REQUIRED=false turns it off (kill switch).
 */
export const adminStepUpRequired = () => String(process.env.ADMIN_STEPUP_REQUIRED ?? 'true').toLowerCase() !== 'false';

/** `verify` is the step-up check (admin-auth.service `stepUp`); a parameter only so checks can pass a fake. */
export const requireAdminStepUp = (action: string, verify: typeof stepUp = stepUp) => async (req: any, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const code = typeof body.adminCode === 'string' ? body.adminCode : undefined;
    const backupCode = typeof body.adminBackupCode === 'string' ? body.adminBackupCode : undefined;
    delete body.adminCode;
    delete body.adminBackupCode;
    if (!adminStepUpRequired()) return next();
    const userId = String(req.user?.userId || req.user?.id || '');
    const sid = String(req.user?.asid || '');
    if (!userId || !sid) {
        return res.status(403).json({ success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Connectez-vous à l’administration et confirmez avec votre code d’authentification.' });
    }
    try {
        const ip = String(req.headers?.['x-real-ip'] || req.headers?.['cf-connecting-ip'] || req.ip || '').slice(0, 64);
        const r = await verify({ userId, sid, code, backupCode, action }, { ip, userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300) });
        if (r.method !== 'window') log.info(`Admin ${userId} confirmed ${action} with ${r.method}.`);
        return next();
    } catch (e: any) {
        const status = Number(e?.statusCode) || 500;
        if (status >= 500) log.error(`Admin step-up failed: ${e?.message ?? e}`);
        return res.status(status).json({ success: false, code: e?.code, message: status >= 500 ? 'Vérification indisponible' : e.message });
    }
};
