import { Request, Response } from 'express';
import { activityBoard, cleanCountries, listActivated, listConnected, Range, Source } from '../../services/activity-dashboard.service';
import { listSignupAttempts, FailureGroup } from '../../services/signup-attempts.service';
import { doualaDay } from '../../services/activity-signals.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ActivityController');

/**
 * Security plan Phase 11: the daily activity board (admin "Activité" and the
 * support desk's panel read the same figures) and the read-only lists behind
 * each number.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).trim() : '');
const source = (v: string): Source | null => (v === 'web' || v === 'app' || v === 'api' ? v : null);
const range = (v: string): Range => (v === '7d' || v === '30d' ? v : 'today');

/** A list's period: from/to (Douala days), at most 31 days, defaulting to today. */
function period(req: Request): { from: string; to: string } {
    const today = doualaDay();
    const to = DAY.test(q(req, 'to')) ? q(req, 'to') : today;
    let from = DAY.test(q(req, 'from')) ? q(req, 'from') : to;
    if (from > to) from = to;
    const span = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400_000;
    if (span > 30) from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 30 * 86400_000).toISOString().slice(0, 10);
    return { from, to };
}

export async function getActivityBoard(req: Request, res: Response): Promise<void> {
    try {
        const data = await activityBoard({ range: range(q(req, 'range')), countries: cleanCountries(q(req, 'countries') || q(req, 'country')), source: source(q(req, 'source')) });
        res.json({ success: true, data });
    } catch (err: any) {
        log.error(`Activity board failed: ${err?.message ?? err}`);
        res.status(500).json({ success: false, message: 'Activité indisponible' });
    }
}

export async function getActivityList(req: Request, res: Response): Promise<void> {
    try {
        const { from, to } = period(req);
        const country = cleanCountries(q(req, 'country'))?.[0] ?? null;
        const countries = cleanCountries(q(req, 'countries'));
        const base = { from, to, country, countries, cursor: q(req, 'cursor') || null, limit: Number(q(req, 'limit')) || 50 };
        const kind = q(req, 'kind');
        let data;
        if (kind === 'connected') data = await listConnected({ ...base, source: source(q(req, 'source')) });
        else if (kind === 'activated') data = await listActivated(base);
        else {
            const outcome = q(req, 'outcome');
            const group = q(req, 'group');
            data = await listSignupAttempts({
                ...base,
                source: source(q(req, 'source')),
                outcome: outcome === 'in_progress' || outcome === 'completed' || outcome === 'failed' ? outcome : null,
                reason: /^[a-z_]{2,40}$/.test(q(req, 'reason')) ? q(req, 'reason') : null,
                group: ['sbc_code', 'provider_api', 'member', 'unknown'].includes(group) ? (group as FailureGroup) : null,
            });
        }
        res.json({ success: true, data: { ...data, from, to } });
    } catch (err: any) {
        log.error(`Activity list failed: ${err?.message ?? err}`);
        res.status(500).json({ success: false, message: 'Liste indisponible' });
    }
}
