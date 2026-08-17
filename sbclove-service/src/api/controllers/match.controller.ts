import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { matchService } from '../../services/match.service';
import { moderationService } from '../../services/moderation.service';
import { ContactChoice } from '../../types/sbclove.enums';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('MatchController');

class MatchController {

    async getMyMatches(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
            const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
            const matches = await matchService.getMyMatches(req.user!.userId, limit, (page - 1) * limit);
            res.status(200).json({ success: true, data: matches });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async setContactChoice(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const { choice } = req.body as { choice: ContactChoice };
            if (!Object.values(ContactChoice).includes(choice)) {
                throw new AppError('Invalid contact choice.', 400);
            }
            const result = await matchService.setContactChoice(req.user!.userId, req.params.id, choice);
            res.status(200).json({ success: true, message: 'Choice recorded.', data: result });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async reportProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await moderationService.reportProfile(req.user!.userId, req.params.id, req.body.reason);
            res.status(200).json({ success: true, message: 'Profile reported.', data: result });
        } catch (error) {
            this.handle(error, res, next);
        }
    }

    async blockProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const result = await moderationService.blockProfile(req.user!.userId, req.params.id);
            res.status(200).json({ success: true, message: 'Profile blocked.', data: result });
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

export const matchController = new MatchController();
