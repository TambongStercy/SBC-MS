import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { profileService } from '../../services/profile.service';
import { interestService } from '../../services/interest.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('ProfileController');

const parsePagination = (req: AuthenticatedRequest) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 50);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    return { limit, skip: (page - 1) * limit, page };
};

class ProfileController {

    async createProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { displayName, intention, otherIntentionText, description } = req.body;
            const view = await profileService.createProfile(userId, { displayName, intention, otherIntentionText, description });
            res.status(201).json({ success: true, message: 'Profile created and pending validation.', data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async getMyProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const view = await profileService.getMyProfile(req.user!.userId);
            if (!view) {
                res.status(404).json({ success: false, message: 'You do not have a SBCLOVE profile yet.' });
                return;
            }
            res.status(200).json({ success: true, data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const view = await profileService.updateProfile(req.user!.userId, req.body);
            res.status(200).json({ success: true, message: 'Profile updated and pending re-validation.', data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async uploadPhotos(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const files = (req.files as Express.Multer.File[]) || [];
            if (files.length === 0) {
                throw new AppError('No photos provided.', 400);
            }
            const view = await profileService.addPhotos(req.user!.userId, files.map(f => ({
                buffer: f.buffer,
                originalname: f.originalname,
                mimetype: f.mimetype,
            })));
            res.status(200).json({ success: true, message: 'Photos uploaded.', data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async deletePhoto(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const view = await profileService.deletePhoto(req.user!.userId, req.params.fileId);
            res.status(200).json({ success: true, message: 'Photo deleted.', data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async reorderPhotos(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { order } = req.body as { order: string[] };
            if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) {
                throw new AppError('`order` must be an array of photo fileIds.', 400);
            }
            const view = await profileService.reorderPhotos(req.user!.userId, order);
            res.status(200).json({ success: true, message: 'Photos reordered.', data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async browse(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit, skip, page } = parsePagination(req);
            const { items, total } = await profileService.browse(req.user!.userId, limit, skip);
            res.status(200).json({
                success: true,
                data: items,
                pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const view = await profileService.getProfileForViewer(req.user!.userId, req.params.id);
            res.status(200).json({ success: true, data: view });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async expressInterest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await interestService.expressInterest(req.user!.userId, req.params.id);
            res.status(200).json({
                success: true,
                message: result.matched ? "C'est un match !" : 'Intérêt enregistré.',
                data: result,
            });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async getMyInterests(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { limit, skip } = parsePagination(req);
            const [items, remaining] = await Promise.all([
                interestService.getSentInterests(req.user!.userId, limit, skip),
                interestService.remainingInterests(req.user!.userId),
            ]);
            res.status(200).json({ success: true, data: items, meta: { interestsLeftThisWeek: remaining } });
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

export const profileController = new ProfileController();
