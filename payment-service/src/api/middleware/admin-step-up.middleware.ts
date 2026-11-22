import { NextFunction, Request, Response } from 'express';
import { userServiceClient } from '../../services/clients/user.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminStepUp');

/**
 * Security plan Phase 3 item 6: an admin money action (withdrawal from a member's balance,
 * direct payout, approval, manual completion) needs the admin's OWN authenticator code, not just
 * an admin token. The code travels in the body (`adminCode`, or `adminBackupCode`) and is removed
 * from it before the handler runs, so it never reaches a log or a transaction's metadata.
 * user-service checks it against the admin's authenticator and the admin session (`asid` in the
 * token), and opens a 10-minute window on that session: a batch of approvals needs one code.
 * The Phase 4 fraud decision is applied by the money paths themselves (assertWithdrawalsNotLocked).
 *
 * ADMIN_STEPUP_REQUIRED=false turns it off (kill switch). Fails closed: user-service down → 503.
 * Service callers (service secret, no admin token) are not affected: they never reach these routes.
 */
export const adminStepUpRequired = () => String(process.env.ADMIN_STEPUP_REQUIRED ?? 'true').toLowerCase() !== 'false';

const clientIp = (req: Request) => String(req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.ip || '').slice(0, 64);

export const requireAdminStepUp = (action: string) => async (req: Request, res: Response, next: NextFunction) => {
    const body: any = req.body && typeof req.body === 'object' ? req.body : {};
    const code = typeof body.adminCode === 'string' ? body.adminCode : undefined;
    const backupCode = typeof body.adminBackupCode === 'string' ? body.adminBackupCode : undefined;
    delete body.adminCode;
    delete body.adminBackupCode;
    if (!adminStepUpRequired()) return next();

    const user: any = (req as any).user ?? {};
    const userId = String(user.userId || user.id || '');
    const sid = String(user.asid || '');
    if (!userId || !sid) {
        // a token without an admin session (member-app token, script) moves no money
        return res.status(403).json({ success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Connectez-vous à l’administration et confirmez avec votre code d’authentification.' });
    }
    try {
        const r = await userServiceClient.adminStepUp({ userId, sid, code, backupCode, action, ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });
        (req as any).adminStepUp = r;
        if (r?.method !== 'window') log.info(`Admin ${userId} confirmed ${action} with ${r?.method}.`);
        return next();
    } catch (e: any) {
        const status = Number(e?.statusCode) || 503;
        if (status === 403 || status === 401) log.warn(`Admin ${userId} ${action} refused: ${e?.code ?? status}.`);
        return res.status(status).json({ success: false, code: e?.code, message: e?.message || 'Code requis.' });
    }
};
