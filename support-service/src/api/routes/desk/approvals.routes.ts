import { Router } from 'express';
import { Types } from 'mongoose';
import { ah } from '../../middleware/async';
import { agentOf, assertPermission, reqCtx, requireReauth } from '../../middleware/agent-auth';
import { Approval, APPROVAL_STATUSES } from '../../../database/models/approval.model';
import { APPROVAL_PERMISSIONS, approve, cancel, executeAgain, reject } from '../../../services/approval.service';
import { hasPermission } from '../../../config/permissions';
import { badRequest, notFound } from '../../../utils/errors';
import { maskEmail, maskPhone } from '../../../utils/mask';

const router = Router();

const ref = (req: any) => { const a = agentOf(req); return { id: a.id, name: a.name, roles: a.roles }; };

/** The new contact value is shown in clear only to full readers. */
function present(a: any, roles: string[]) {
    if (a.type !== 'contact_change' || hasPermission(roles, 'members.read.full')) return a;
    const p = { ...a.payload };
    p.newValue = p.field === 'email' ? maskEmail(p.newValue) : maskPhone(p.newValue);
    return { ...a, payload: p };
}

/** Requests an agent may see: the ones it made, and the types it may approve. */
router.get('/', ah(async (req, res) => {
    const agent = agentOf(req);
    const approvable = Object.entries(APPROVAL_PERMISSIONS).filter(([, p]) => hasPermission(agent.roles, p.approve)).map(([t]) => t);
    const q = req.query as Record<string, string>;
    const filter: Record<string, unknown> = { $or: [{ 'requestedBy.id': agent.id }, { type: { $in: approvable } }] };
    if (q.status && (APPROVAL_STATUSES as readonly string[]).includes(q.status)) filter.status = q.status;
    if (q.type) filter.type = q.type;
    const items = await Approval.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: items.map((a) => present(a, agent.roles)) });
}));

router.get('/:id', ah(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await Approval.findById(req.params.id).lean();
    if (!a) throw notFound('Demande introuvable.');
    const agent = agentOf(req);
    if (a.requestedBy.id !== agent.id) assertPermission(req, APPROVAL_PERMISSIONS[a.type].approve);
    res.json({ success: true, data: present(a, agent.roles) });
}));

async function permFor(req: any) {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await Approval.findById(req.params.id, { type: 1 }).lean();
    if (!a) throw notFound('Demande introuvable.');
    assertPermission(req, APPROVAL_PERMISSIONS[a.type].approve);
}

router.post('/:id/approve', requireReauth, ah(async (req, res) => {
    await permFor(req);
    const r = await approve(req.params.id, ref(req), typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : undefined, reqCtx(req));
    res.json({ success: true, data: present(r, agentOf(req).roles) });
}));

router.post('/:id/reject', requireReauth, ah(async (req, res) => {
    await permFor(req);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
    if (reason.length < 3) throw badRequest('Indiquez le motif du refus.', 'REASON_REQUIRED');
    res.json({ success: true, data: await reject(req.params.id, ref(req), reason, reqCtx(req)) });
}));

router.post('/:id/execute', requireReauth, ah(async (req, res) => {
    await permFor(req);
    res.json({ success: true, data: await executeAgain(req.params.id, ref(req), reqCtx(req)) });
}));

router.post('/:id/cancel', ah(async (req, res) => {
    res.json({ success: true, data: await cancel(req.params.id, ref(req), reqCtx(req)) });
}));

export default router;
