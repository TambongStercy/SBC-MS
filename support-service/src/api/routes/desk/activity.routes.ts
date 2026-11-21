import { Router } from 'express';
import { ah } from '../../middleware/async';
import { agentOf, requirePermission } from '../../middleware/agent-auth';
import { getActivityBoard } from '../../../services/clients/user.client';

/**
 * Security plan Phase 11: the day's activity panel (members connected,
 * sign-ups completed and failed with their reason, activations, unfinished
 * payments), read from user-service, which computes the same figures for the
 * admin. An agent with a country team sees only those countries; asking for
 * another one gives an empty board, never its figures.
 */
const router = Router();

router.get('/activity', requirePermission('activity.read'), ah(async (req, res) => {
    const agent = agentOf(req);
    const asked = String(req.query.country ?? '').trim().toUpperCase();
    const team = agent.countries ?? [];
    let countries: string[] | undefined;
    if (/^[A-Z]{2}$/.test(asked)) countries = team.length && !team.includes(asked) ? ['--'] : [asked];
    else if (team.length) countries = team;
    const range = ['today', '7d', '30d'].includes(String(req.query.range)) ? String(req.query.range) : 'today';
    const source = ['web', 'app', 'api'].includes(String(req.query.source)) ? String(req.query.source) : undefined;
    const board = countries?.[0] === '--'
        ? null
        : await getActivityBoard({ range, source, countries });
    res.json({ success: true, data: { board, team } });
}));

export default router;
