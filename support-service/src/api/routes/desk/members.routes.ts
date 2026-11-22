import { Router } from 'express';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, assertPermission, reqCtx, requirePermission, requireReauth } from '../../middleware/agent-auth';
import * as members from '../../../services/member.service';
import { audit } from '../../../services/audit.service';
import { hasPermission } from '../../../config/permissions';
import { presentTickets } from '../../presenters';
import { requestAuthenticatorReset, requestFreeze } from '../../../services/risk.service';

const router = Router();
const ref = (req: any) => { const a = agentOf(req); return { id: a.id, name: a.name, roles: a.roles }; };
const limitOf = (req: any) => Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

/** Money on the record: finance readers, or agents who check activations. */
function assertMoneyRead(req: any) {
    const roles = agentOf(req).roles;
    if (!hasPermission(roles, 'finance.read') && !hasPermission(roles, 'activation.check')) assertPermission(req, 'finance.read');
}

// POST, not GET: the search text is usually an email or a phone number, and a
// query string ends up in the gateway and nginx access logs and the browser history.
router.post('/search', requirePermission('members.read'), ah(async (req, res) => {
    const hits = await members.search(req.body?.q);
    await audit({ actor: actorOf(req), action: 'member.search', meta: { results: hits.length }, ...reqCtx(req) });
    res.json({ success: true, data: hits });
}));

router.get('/:userId', requirePermission('members.read'), ah(async (req, res) => {
    const member = await members.profile(req.params.userId, agentOf(req).roles);
    await audit({ actor: actorOf(req), action: 'member.viewed', target: { type: 'member', id: req.params.userId }, meta: { unmasked: !member.masked }, ...reqCtx(req) });
    res.json({ success: true, data: { member } });
}));

router.get('/:userId/payins', requirePermission('members.read'), ah(async (req, res) => {
    assertMoneyRead(req);
    res.json({ success: true, data: await members.payins(req.params.userId, limitOf(req)) });
}));

router.get('/:userId/withdrawals', requirePermission('members.read'), ah(async (req, res) => {
    assertMoneyRead(req);
    res.json({ success: true, data: await members.withdrawalsWithText(req.params.userId, limitOf(req)) });
}));

router.get('/:userId/tickets', requirePermission('members.read', 'tickets.read'), ah(async (req, res) => {
    res.json({ success: true, data: await presentTickets(await members.memberTickets(req.params.userId, agentOf(req).countries)) });
}));

// Security plan Phase 4: the fraud engine's score, reasons and linked accounts (finance managers).
router.get('/:userId/risk', requirePermission('risk.read'), ah(async (req, res) => {
    const card = await members.riskCard(req.params.userId);
    await audit({ actor: actorOf(req), action: 'member.risk.viewed', target: { type: 'member', id: req.params.userId }, meta: { available: card.available }, ...reqCtx(req) });
    res.json({ success: true, data: card });
}));

// Security plan Phase 5: lost phone (after ID + selfie) → finance manager approves → user-service removes the app.
router.post('/:userId/authenticator-reset', requirePermission('authenticator.reset.request'), requireReauth, ah(async (req, res) => {
    const a = await requestAuthenticatorReset(req.params.userId, req.body ?? {}, ref(req), reqCtx(req));
    res.status(201).json({ success: true, data: { approvalId: String(a._id), status: a.status } });
}));

// Security plan Phase 5: freeze or unfreeze the member's money (finance managers; another one approves).
router.post('/:userId/freeze', requirePermission('risk.decide'), requireReauth, ah(async (req, res) => {
    const a = await requestFreeze(req.params.userId, req.body ?? {}, ref(req), reqCtx(req));
    res.status(201).json({ success: true, data: { approvalId: String(a._id), status: a.status } });
}));

// Contact change for a member who lost access: request → approval → code to the new contact → apply.
router.post('/:userId/contact-change', requirePermission('members.contact.request'), requireReauth, ah(async (req, res) => {
    const a = await members.requestContactChange(req.params.userId, req.body ?? {}, ref(req), reqCtx(req));
    res.status(201).json({ success: true, data: { approvalId: String(a._id), status: a.status } });
}));

router.post('/contact-change/:approvalId/send-code', ah(async (req, res) => {
    res.json({ success: true, data: await members.sendContactCode(req.params.approvalId, ref(req), agentOf(req).roles, reqCtx(req)) });
}));

router.post('/contact-change/:approvalId/apply', requireReauth, ah(async (req, res) => {
    res.json({ success: true, data: await members.applyContactChange(req.params.approvalId, req.body?.code, ref(req), agentOf(req).roles, reqCtx(req)) });
}));

export default router;
