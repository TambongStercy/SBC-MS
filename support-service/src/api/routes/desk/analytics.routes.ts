import { Router } from 'express';
import { Types } from 'mongoose';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission } from '../../middleware/agent-auth';
import { analytics } from '../../../services/analytics.service';
import { parsePeriod } from '../../../services/report.service';
import { setClientErrorState } from '../../../services/client-error.service';
import { audit } from '../../../services/audit.service';
import { ClientErrorType } from '../../../database/models/client-error.model';
import { notFound } from '../../../utils/errors';

/** « Analytique » for the support administrator (desk). */
const router = Router();

router.get('/analytics', requirePermission('analytics.read'), ah(async (req, res) => {
    const { from, to } = parsePeriod(req.query as Record<string, unknown>);
    res.json({ success: true, data: await analytics(from, to) });
}));

/** Marks a technical error type « en cours de traitement » / « corrigé » (or back to « ouvert »). Audited. */
router.post('/analytics/errors/:id/state', requirePermission('errors.manage'), ah(async (req, res) => {
    const r = await setClientErrorState(req.params.id, req.body?.state, req.body?.note, agentOf(req));
    await audit({ actor: actorOf(req), action: 'client_error.state', target: { type: 'client_error', id: req.params.id }, before: r.before, after: r.after, reason: typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

/** A member session that hit this error (OpenReplay); each opening is audited, as for a ticket's replay. */
router.post('/analytics/errors/:id/replay', requirePermission('analytics.read'), ah(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const t = await ClientErrorType.findById(req.params.id, { lastReplay: 1, signature: 1 }).lean();
    if (!t?.lastReplay?.url) throw notFound('Pas d’enregistrement de session pour cette erreur.');
    await audit({ actor: actorOf(req), action: 'client_error.replay.opened', target: { type: 'client_error', id: req.params.id }, after: { sessionId: t.lastReplay.sessionId }, ...reqCtx(req) });
    res.json({ success: true, data: { url: t.lastReplay.url } });
}));

export default router;
