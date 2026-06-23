import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { moduleConfigRepository } from '../../database/repositories/module-config.repository';
import { getWindowStatus } from '../../utils/sbcloveWindow';
import logger from '../../utils/logger';

const log = logger.getLogger('ModuleController');

class ModuleController {

    /**
     * GET /sbclove/status — tells the client whether the module is currently
     * open (kill-switch + weekly window) and when the next session opens.
     * Not window-gated: callers need this precisely when the module is closed.
     */
    async getStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const cfg = await moduleConfigRepository.get();
            const window = getWindowStatus(new Date(), cfg);
            res.status(200).json({
                success: true,
                data: {
                    enabled: cfg.enabled,
                    // Open only when both the kill-switch is on AND inside the window.
                    isOpen: cfg.enabled && window.isOpen,
                    timezone: window.timezone,
                    activeWeekday: window.activeWeekday,
                    openHour: window.openHour,
                    closeHour: window.closeHour,
                    nextOpenAt: window.nextOpenAt,
                },
            });
        } catch (error) {
            log.error('Failed to compute module status:', error);
            next(error);
        }
    }
}

export const moduleController = new ModuleController();
