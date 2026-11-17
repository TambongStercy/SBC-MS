import { Response, NextFunction } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import UserModel, { UserRole, ADMIN_CAPABLE_ROLES } from '../../database/models/user.model';
import { AuthenticatedRequest } from './auth.middleware';
import logger from '../../utils/logger';

const log = logger.getLogger('ProtectAdminAccounts');

/**
 * Only a super admin may change an account that can sign in to the admin
 * (admin, staff, withdrawal_admin, moderator), its own included.
 *
 * Without this, a staff account with write on `members` could change a super
 * admin's email or phone and then reset the password, or block or delete
 * every super admin. With write on `finance` it could credit its own balance.
 *
 * `from` says where the target id is: the `:userId` path param (default) or
 * `body.userId` (partner routes).
 */
export const protectAdminAccounts = (from: 'params' | 'body' = 'params') =>
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (req.user?.role === UserRole.ADMIN) return next();

        const targetId = from === 'body' ? req.body?.userId : req.params.userId;
        // Bad ids are answered by the handler itself.
        if (!isValidObjectId(targetId)) return next();

        try {
            // The native driver skips the soft-delete hook, so a deleted admin
            // account (restore route) is found too.
            const target = await UserModel.collection.findOne(
                { _id: new Types.ObjectId(String(targetId)) },
                { projection: { role: 1 } },
            );
            if (target && ADMIN_CAPABLE_ROLES.includes(target.role as UserRole)) {
                log.warn(`Refused: ${req.user?.role} ${req.user?.userId} tried ${req.method} ${req.originalUrl} on ${target.role} account ${targetId}`);
                res.status(403).json({ success: false, message: 'Seul un super admin peut modifier un compte de l’équipe admin.' });
                return;
            }
            next();
        } catch (error: any) {
            log.error(`Target role check failed for ${targetId}: ${error?.message}`);
            res.status(503).json({ success: false, message: 'Vérification impossible pour le moment. Réessayez.' });
        }
    };
