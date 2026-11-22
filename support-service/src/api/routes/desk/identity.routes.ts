import { Router } from 'express';
import { ah } from '../../middleware/async';
import { agentOf, reqCtx, requirePermission, requireReauth } from '../../middleware/agent-auth';
import { deskDecide, deskDetail, deskImage, deskList } from '../../../services/identity.service';

/** KYC level 3: « Identités » (identity.review = any support agent but the views verifiers). */
const router = Router();
const who = (req: any) => { const a = agentOf(req); return { id: a.id, name: a.name, roles: a.roles, countries: a.countries }; };

router.get('/', requirePermission('identity.review'), ah(async (req, res) => {
    res.json({ success: true, data: await deskList(req.query as Record<string, unknown>, agentOf(req).countries) });
}));

router.get('/:id', requirePermission('identity.review'), ah(async (req, res) => {
    res.json({ success: true, data: await deskDetail(req.params.id, who(req), reqCtx(req)) });
}));

// The image itself, streamed from the secondary server; never cached, every view audited.
router.get('/:id/images/:kind', requirePermission('identity.review'), ah(async (req, res) => {
    const img = await deskImage(req.params.id, req.params.kind, who(req), reqCtx(req));
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.send(img.data);
}));

router.post('/:id/decision', requirePermission('identity.review'), requireReauth, ah(async (req, res) => {
    res.json({ success: true, data: await deskDecide(req.params.id, req.body ?? {}, who(req), reqCtx(req)) });
}));

export default router;
