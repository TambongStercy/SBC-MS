import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { moduleConfigRepository } from '../../database/repositories/module-config.repository';
import { isWindowOpen } from '../../utils/sbcloveWindow';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('ModuleWindowMiddleware');

/**
 * Gates browsing and interactions to the weekly session window and the global
 * enable switch (spec §2, §14). Self profile-management routes are NOT gated.
 *
 * Outside the window the module is "automatically closed": profiles are not
 * browsable and interactions are disabled.
 */
export const enforceModuleWindow = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const cfg = await moduleConfigRepository.get();
        if (!cfg.enabled) {
            return next(new AppError('SBCLOVE is currently disabled.', 423)); // 423 Locked
        }
        if (!isWindowOpen(new Date(), cfg)) {
            return next(new AppError('SBCLOVE is closed. The module is open on its weekly session window only.', 423));
        }
        next();
    } catch (error) {
        log.error('Error evaluating module window:', error);
        next(error);
    }
};
