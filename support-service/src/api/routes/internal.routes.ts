import { Router } from 'express';
import { ah } from '../middleware/async';
import { requireService } from '../middleware/service-auth';
import { upsertCase } from '../../services/case.service';
import { upsertViewTask } from '../../services/views.service';
import { auditSafe } from '../../services/audit.service';

/** Service-to-service routes (/api/support/internal/*), SERVICE_SECRET in constant time. */
const router = Router();
router.use(requireService);

router.post('/cases', ah(async (req, res) => {
    const caller = (req.header('x-service-name') || 'unknown').slice(0, 40);
    const r = await upsertCase(req.body ?? {}, caller);
    if (r.created) auditSafe({ actor: { type: 'service', id: caller, name: caller }, action: 'case.opened', target: { type: 'case', id: r.caseId }, meta: { type: req.body?.type, severity: req.body?.severity } });
    res.status(r.created ? 201 : 200).json({ success: true, data: r });
}));

router.post('/view-tasks', ah(async (req, res) => {
    const r = await upsertViewTask(req.body ?? {});
    res.status(r.created ? 201 : 200).json({ success: true, data: r });
}));

export default router;
