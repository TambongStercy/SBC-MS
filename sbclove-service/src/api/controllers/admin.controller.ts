import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { adminService } from '../../services/admin.service';
import { ProfileStatus, ReportStatus } from '../../types/sbclove.enums';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminController');

const pagination = (req: AuthenticatedRequest) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    return { limit, skip: (page - 1) * limit, page };
};

class AdminController {

    async listProfiles(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit, skip, page } = pagination(req);
            const status = req.query.status as ProfileStatus | undefined;
            const { items, total } = await adminService.listProfiles(status, limit, skip);
            res.status(200).json({ success: true, data: items, pagination: { total, page, limit } });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async validateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { approve, rejectionReason } = req.body as { approve: boolean; rejectionReason?: string };
            if (typeof approve !== 'boolean') {
                throw new AppError('`approve` (boolean) is required.', 400);
            }
            const updated = await adminService.validateProfile(req.user!.userId, req.params.id, approve, rejectionReason);
            res.status(200).json({ success: true, message: `Profile ${approve ? 'approved' : 'rejected'}.`, data: updated });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async setSuspension(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { suspend, reason } = req.body as { suspend: boolean; reason?: string };
            if (typeof suspend !== 'boolean') {
                throw new AppError('`suspend` (boolean) is required.', 400);
            }
            const updated = await adminService.setSuspension(req.user!.userId, req.params.id, suspend, reason);
            res.status(200).json({ success: true, message: suspend ? 'Profile suspended.' : 'Profile reinstated.', data: updated });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async listReports(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit, skip, page } = pagination(req);
            const status = req.query.status as ReportStatus | undefined;
            const { items, total } = await adminService.listReports(status, limit, skip);
            res.status(200).json({ success: true, data: items, pagination: { total, page, limit } });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async reviewReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { status } = req.body as { status: ReportStatus };
            if (!Object.values(ReportStatus).includes(status)) {
                throw new AppError('Invalid report status.', 400);
            }
            const updated = await adminService.reviewReport(req.user!.userId, req.params.id, status);
            res.status(200).json({ success: true, message: 'Report updated.', data: updated });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async getModuleConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const cfg = await adminService.getModuleConfig();
            res.status(200).json({ success: true, data: cfg });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async updateModuleConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const cfg = await adminService.updateModuleConfig(req.user!.userId, req.body);
            res.status(200).json({ success: true, message: 'Module configuration updated.', data: cfg });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    private handle(error: unknown, res: Response, next: NextFunction): void {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ success: false, message: error.message });
        } else {
            log.error('Unexpected controller error:', error);
            next(error);
        }
    }
}

export const adminController = new AdminController();
