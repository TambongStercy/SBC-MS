import { Request, Response, NextFunction } from 'express';
import { findApprovedOrganizer } from '../../services/organizer.service';
import { AppError } from '../../utils/errors';
import { AuthenticatedRequest } from './auth.middleware';

/**
 * Loads the caller's approved Organizer document onto req.organizer or 403s.
 * Applied to every organizer/* route except /apply and /me (those need
 * to work before/regardless of approval).
 */
export interface OrganizerRequest extends AuthenticatedRequest {
    organizer?: any;
}

export const requireApprovedOrganizer = async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user?.userId) return next(new AppError('Authentication required', 401));
    const org = await findApprovedOrganizer(user.userId);
    if (!org) return next(new AppError('Compte organisateur non approuvé.', 403));
    (req as OrganizerRequest).organizer = org;
    next();
};
