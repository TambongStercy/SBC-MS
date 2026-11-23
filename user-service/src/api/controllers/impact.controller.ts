import { Request, Response } from 'express';
import { impactMembers, invitationStats } from '../../services/impact-invitations.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ImpactController');

const asDate = (v: unknown): Date | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * [Internal, event-service] Qualification counter of SBC Impact candidates.
 * @route POST /api/users/internal/impact/invitations
 * Body: { referrerIds: string[], from: ISO, to: ISO, need: number, changedSince?: ISO }
 */
export const getImpactInvitations = async (req: Request, res: Response): Promise<void> => {
    try {
        const { referrerIds, need } = req.body ?? {};
        const from = asDate(req.body?.from);
        const to = asDate(req.body?.to);
        const changedSince = req.body?.changedSince ? asDate(req.body.changedSince) : undefined;
        if (!Array.isArray(referrerIds) || !from || !to || from > to || changedSince === null) {
            res.status(400).json({ success: false, message: 'referrerIds (array), from and to (dates) are required.' });
            return;
        }
        const n = Number(need);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
            res.status(400).json({ success: false, message: 'need must be an integer between 1 and 1000.' });
            return;
        }
        const data = await invitationStats({ referrerIds: referrerIds.map(String), from, to, need: n, changedSince });
        res.status(200).json({ success: true, data });
    } catch (error: any) {
        log.error(`impact invitations failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to compute invitations.' });
    }
};

/**
 * [Internal, event-service] Profile subset of SBC Impact candidates.
 * @route POST /api/users/internal/impact/members
 * Body: { userIds: string[] }
 */
export const getImpactMembers = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userIds } = req.body ?? {};
        if (!Array.isArray(userIds)) {
            res.status(400).json({ success: false, message: 'userIds (array) is required.' });
            return;
        }
        res.status(200).json({ success: true, data: await impactMembers(userIds.map(String)) });
    } catch (error: any) {
        log.error(`impact members failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to load members.' });
    }
};
