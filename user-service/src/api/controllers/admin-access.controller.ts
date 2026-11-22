import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import UserModel, { UserRole, ADMIN_CAPABLE_ROLES } from '../../database/models/user.model';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { DELEGABLE_MODULES, effectivePermissions, sanitizePermissions } from '../../config/admin-modules';
import { toPlainPermissions } from '../../services/user.service';
import logger from '../../utils/logger';
import { checkSession, revokeAllSessions, securityStatus } from '../../services/admin-auth.service';

const log = logger.getLogger('AdminAccessController');

const STAFF_FIELDS = 'name email phoneNumber avatar role adminPermissions blocked createdAt updatedAt';

const accessOf = (user: { role?: string; adminPermissions?: unknown }) =>
    effectivePermissions(user.role, toPlainPermissions(user.adminPermissions));

const staffView = (u: any) => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    phoneNumber: u.phoneNumber,
    avatar: u.avatar,
    role: u.role,
    blocked: !!u.blocked,
    permissions: accessOf(u),
    updatedAt: u.updatedAt,
});

/**
 * Per-module admin access (config/admin-modules.ts). The gateway reads
 * GET /users/internal/:userId/admin-access on every admin call; the team
 * screens (super admin only) read and change it here.
 */
class AdminAccessController {
    /** Service-only: what this account may do in the admin. */
    async getInternalAccess(req: Request, res: Response): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Invalid user id' });
            return;
        }
        try {
            // The model's pre-find hook already leaves deleted accounts out.
            const user = await UserModel.findById(userId).select('role adminPermissions blocked').lean();
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }
            // ?sid= : the admin session the token carries (admin-auth.service). The
            // gateway refuses the call unless it is 'active'.
            const sid = typeof req.query.sid === 'string' ? req.query.sid : '';
            const session = sid ? await checkSession(userId, sid) : 'missing';
            res.status(200).json({
                success: true,
                data: { role: user.role, blocked: !!user.blocked, permissions: (user as any).blocked ? {} : accessOf(user as any), session },
            });
        } catch (error: any) {
            log.error(`Error reading admin access for ${userId}: ${error.message}`);
            res.status(500).json({ success: false, message: 'Error reading admin access' });
        }
    }

    /** The signed-in staff member's own access, so the admin refreshes its menu. */
    async getMyAccess(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const user = await UserModel.findById(req.user?.userId).select('role adminPermissions blocked').lean();
            if (!user || user.blocked) {
                res.status(403).json({ success: false, message: 'Accès refusé.' });
                return;
            }
            res.status(200).json({ success: true, data: { role: user.role, permissions: accessOf(user as any), modules: DELEGABLE_MODULES } });
        } catch (error: any) {
            log.error(`Error reading own admin access: ${error.message}`);
            res.status(500).json({ success: false, message: 'Error reading admin access' });
        }
    }

    /** Super admin: everyone who can sign in to the admin. */
    async listStaff(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const users = await UserModel.find({ role: { $in: ADMIN_CAPABLE_ROLES } })
                .select(STAFF_FIELDS).sort({ role: 1, name: 1 }).lean();
            const security = await securityStatus(users.map(u => String(u._id)));
            res.status(200).json({
                success: true,
                data: { staff: users.map(u => ({ ...staffView(u), security: security[String(u._id)] })), modules: DELEGABLE_MODULES },
            });
        } catch (error: any) {
            log.error(`Error listing staff: ${error.message}`);
            res.status(500).json({ success: false, message: 'Error listing staff' });
        }
    }

    /**
     * Super admin: makes a member a staff account with these module rights, or
     * changes a staff account's rights. Super admins are left alone here (use
     * the role route), so nobody locks the last admin out by accident.
     */
    async setStaffAccess(req: AuthenticatedRequest, res: Response): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Identifiant invalide.' });
            return;
        }
        const permissions = sanitizePermissions(req.body?.permissions);
        try {
            const user = await UserModel.findById(userId).select('role email');
            if (!user) {
                res.status(404).json({ success: false, message: 'Membre introuvable.' });
                return;
            }
            if (user.role === UserRole.ADMIN) {
                res.status(409).json({ success: false, message: 'Ce compte est super admin : il a déjà tous les droits.' });
                return;
            }
            const updated = await UserModel.findByIdAndUpdate(
                userId,
                { $set: { role: UserRole.STAFF, adminPermissions: permissions } },
                { new: true },
            ).select(STAFF_FIELDS).lean();
            log.info(`Admin ${req.user?.userId} set staff access for ${user.email}: ${JSON.stringify(permissions)}`);
            res.status(200).json({ success: true, data: staffView(updated) });
        } catch (error: any) {
            log.error(`Error setting staff access for ${userId}: ${error.message}`);
            res.status(500).json({ success: false, message: 'Impossible d’enregistrer les droits.' });
        }
    }

    /** Super admin: takes every admin right away (the account becomes a member again). */
    async revokeStaff(req: AuthenticatedRequest, res: Response): Promise<void> {
        const { userId } = req.params;
        if (!isValidObjectId(userId)) {
            res.status(400).json({ success: false, message: 'Identifiant invalide.' });
            return;
        }
        try {
            const user = await UserModel.findById(userId).select('role email');
            if (!user) {
                res.status(404).json({ success: false, message: 'Membre introuvable.' });
                return;
            }
            if (user.role === UserRole.ADMIN) {
                res.status(409).json({ success: false, message: 'Un super admin ne se retire pas ici.' });
                return;
            }
            await UserModel.updateOne({ _id: userId }, { $set: { role: UserRole.USER }, $unset: { adminPermissions: 1 } });
            await revokeAllSessions(userId, `admin access removed by ${req.user?.userId}`);
            log.info(`Admin ${req.user?.userId} revoked admin access of ${user.email}`);
            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error(`Error revoking staff ${userId}: ${error.message}`);
            res.status(500).json({ success: false, message: 'Impossible de retirer l’accès.' });
        }
    }
}

export const adminAccessController = new AdminAccessController();
