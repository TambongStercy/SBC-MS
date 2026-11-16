import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import Event from '../../../database/models/event.model';
import Organizer, { OrganizerStatus } from '../../../database/models/organizer.model';
import { AuthenticatedRequest } from '../../../api/middleware/auth.middleware';
import { AppError } from '../../../utils/errors';
import { clientIp } from '../../../utils/client-ip';
import { AnimTeamMember } from '../models/governance.model';
import { AnimCtx, Perm, ROLE_PERMS, TeamRole } from '../types';

export interface AnimRequest extends AuthenticatedRequest {
    animCtx?: AnimCtx;
}

/**
 * Resolves who is acting on `:eventId` and with which rights (§31), and refuses
 * unless the role grants `perm`. Every manage route sits behind this, so
 * isolation (§32) is enforced once: services only ever see this event's ids.
 *
 * OWNER = the approved organizer who owns the event. Otherwise an ACTIVE team
 * member of that organizer, for this event or for all of its events.
 * A 404 (not 403) for strangers: they shouldn't learn the event exists.
 */
export const resolveEventRole = async (userId: string, eventId: string): Promise<{ ctx: Omit<AnimCtx, 'ip'> } | null> => {
    if (!Types.ObjectId.isValid(eventId) || !Types.ObjectId.isValid(userId)) return null;
    const event = await Event.findById(eventId).select('organizerId').lean();
    if (!event) return null;
    const organizer = await Organizer.findById(event.organizerId).select('userId status').lean();
    if (!organizer) return null;
    const base = { organizerId: String(organizer._id), eventId: String(event._id), actorUserId: userId };

    if (String(organizer.userId) === userId && organizer.status === OrganizerStatus.APPROVED) {
        return { ctx: { ...base, role: TeamRole.OWNER, perms: ROLE_PERMS[TeamRole.OWNER] } };
    }
    const member = await AnimTeamMember.findOne({
        organizerId: organizer._id,
        userId: new Types.ObjectId(userId),
        status: 'ACTIVE',
        $or: [{ eventId: event._id }, { eventId: null }],
    }).sort({ eventId: -1 }).lean(); // an event-specific role wins over the organizer-wide one
    if (!member) return null;
    return { ctx: { ...base, role: member.role as TeamRole, perms: ROLE_PERMS[member.role] ?? [] } };
};

export const requireEventRole = (perm: Perm) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId) throw new AppError('Authentification requise.', 401);
        const resolved = await resolveEventRole(String(user.userId), String(req.params.eventId));
        if (!resolved) throw new AppError('Événement introuvable.', 404);
        if (!resolved.ctx.perms.includes(perm)) {
            throw new AppError('Votre rôle ne permet pas cette action.', 403, true, 'FORBIDDEN_ROLE');
        }
        (req as AnimRequest).animCtx = { ...resolved.ctx, ip: clientIp(req) };
        next();
    } catch (err) {
        next(err);
    }
};

export const ctxOf = (req: Request): AnimCtx => {
    const ctx = (req as AnimRequest).animCtx;
    if (!ctx) throw new AppError('Contexte manquant.', 500);
    return ctx;
};

export const can = (ctx: AnimCtx, perm: Perm) => ctx.perms.includes(perm);
