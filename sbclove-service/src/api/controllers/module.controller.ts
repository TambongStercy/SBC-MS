import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { moduleConfigRepository } from '../../database/repositories/module-config.repository';
import { getWindowStatus } from '../../utils/sbcloveWindow';
import logger from '../../utils/logger';

const log = logger.getLogger('ModuleController');

// /status is polled by every client every ~60s. When the module is closed the
// computation does a ~192-iteration Intl scan to find nextOpenAt, so we memoize
// the whole payload for a short TTL. The window only changes on hour boundaries,
// so a few seconds of staleness is irrelevant. Per-replica cache.
const STATUS_TTL_MS = 15 * 1000;

interface StatusPayload {
    enabled: boolean;
    isOpen: boolean;
    timezone: string;
    activeWeekday: number;
    openHour: number;
    closeHour: number;
    nextOpenAt: Date | null;
}

class ModuleController {

    private statusCache: { value: StatusPayload; expiresAt: number } | null = null;

    /**
     * GET /sbclove/status — tells the client whether the module is currently
     * open (kill-switch + weekly window) and when the next session opens.
     * Not window-gated: callers need this precisely when the module is closed.
     */
    async getStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            if (this.statusCache && this.statusCache.expiresAt > Date.now()) {
                res.status(200).json({ success: true, data: this.statusCache.value });
                return;
            }

            const cfg = await moduleConfigRepository.get();
            const window = getWindowStatus(new Date(), cfg);
            const payload: StatusPayload = {
                enabled: cfg.enabled,
                // Open only when both the kill-switch is on AND inside the window.
                isOpen: cfg.enabled && window.isOpen,
                timezone: window.timezone,
                activeWeekday: window.activeWeekday,
                openHour: window.openHour,
                closeHour: window.closeHour,
                nextOpenAt: window.nextOpenAt,
            };
            this.statusCache = { value: payload, expiresAt: Date.now() + STATUS_TTL_MS };
            res.status(200).json({ success: true, data: payload });
        } catch (error) {
            log.error('Failed to compute module status:', error);
            next(error);
        }
    }
}

export const moduleController = new ModuleController();
