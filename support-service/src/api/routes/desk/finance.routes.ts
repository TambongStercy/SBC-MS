import { Router } from 'express';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission, requireReauth } from '../../middleware/agent-auth';
import { memberPayins, financeSummary, financeWithdrawals, recheckWithdrawal } from '../../../services/clients/payment.client';
import { deskRecheckPayin } from '../../../services/activation.service';
import { lookupPayin, recheckPayin } from '../../../services/clients/payment.client';
import { asPage, presentCase, presentCases, agentNames } from '../../presenters';
import { notFound } from '../../../utils/errors';
import { createApproval } from '../../../services/approval.service';
import '../../../services/finance.service'; // registers the regularization executor
import * as cases from '../../../services/case.service';
import { audit } from '../../../services/audit.service';
import { getSetting } from '../../../services/settings.service';
import { hasPermission } from '../../../config/permissions';
import { Approval } from '../../../database/models/approval.model';
import { badRequest, conflict } from '../../../utils/errors';

const router = Router();
const ref = (req: any) => { const a = agentOf(req); return { id: a.id, name: a.name, roles: a.roles }; };
const reason = (v: unknown, min = 10) => {
    const r = typeof v === 'string' ? v.trim().slice(0, 2000) : '';
    if (r.length < min) throw badRequest(`Le motif est obligatoire (${min} caractères au moins).`, 'REASON_REQUIRED');
    return r;
};

// ---------- activation ----------
router.get('/activation/members/:userId/payins', requirePermission('activation.check'), ah(async (req, res) => {
    res.json({ success: true, data: await memberPayins(req.params.userId, 20) });
}));

router.post('/activation/members/:userId/payins/:sessionId/recheck', requirePermission('activation.check'), ah(async (req, res) => {
    const r = await deskRecheckPayin(req.params.userId, req.params.sessionId);
    await audit({ actor: actorOf(req), action: 'activation.recheck', target: { type: 'payin', id: req.params.sessionId }, after: { result: r.result.result, provider: r.result.provider }, meta: { userId: req.params.userId }, ...reqCtx(req) });
    res.json({ success: true, data: r });
}));

/** `{ userId?, sessionId?, reference? }` → RecheckResult. With a userId the payment must belong to that member. */
router.post('/activation/check', requirePermission('activation.check'), ah(async (req, res) => {
    const b = req.body ?? {};
    const ref = typeof b.sessionId === 'string' && b.sessionId.trim() ? b.sessionId.trim() : typeof b.reference === 'string' ? b.reference.trim() : '';
    if (!ref || ref.length > 120) throw badRequest('Indiquez un paiement ou une référence.', 'BAD_REFERENCE');
    const userId = typeof b.userId === 'string' && /^[a-f0-9]{24}$/i.test(b.userId) ? b.userId : undefined;
    const payin = await lookupPayin(ref, userId);
    if (!payin) throw notFound('Paiement introuvable' + (userId ? ' pour ce membre.' : '.'));
    const result = await recheckPayin(payin.sessionId);
    await audit({ actor: actorOf(req), action: 'activation.recheck', target: { type: 'payin', id: payin.sessionId }, after: { result: result.result, provider: result.provider }, meta: { userId: userId ?? null }, ...reqCtx(req) });
    res.json({ success: true, data: result });
}));

/** Manual activation: always through an approval (approval.manualActivation = always). */
const manualRequest = ah(async (req, res) => {
    const b = req.body ?? {};
    const userId = typeof b.userId === 'string' && /^[a-f0-9]{24}$/i.test(b.userId) ? b.userId : null;
    const gateway = typeof b.gateway === 'string' ? b.gateway.trim().slice(0, 40) : '';
    const externalRef = typeof b.externalRef === 'string' ? b.externalRef.trim().slice(0, 120) : '';
    const plan = typeof b.plan === 'string' ? b.plan.trim().toUpperCase().slice(0, 30) : '';
    if (!userId || !gateway || !externalRef || !plan) throw badRequest('Membre, opérateur, référence et pack sont obligatoires.', 'BAD_REQUEST');
    if (await getSetting('approval.manualActivation') !== 'always') throw conflict('Réglage inattendu.', 'SETTING');
    const a = await createApproval({
        type: 'manual_activation', requestedBy: ref(req), reason: reason(b.reason), payload: { userId, gateway, externalRef, plan },
        subject: { userId }, ticketId: b.ticketId ?? null, caseId: b.caseId ?? null,
    }, reqCtx(req));
    res.status(201).json({ success: true, data: { approvalId: String(a._id), status: a.status } });
});
router.post('/activation/manual-requests', requirePermission('activation.manual.request'), requireReauth, manualRequest);
router.post('/activation/manual', requirePermission('activation.manual.request'), requireReauth, manualRequest);

// ---------- finance board ----------
router.get('/finance/summary', requirePermission('finance.read'), ah(async (req, res) => {
    const q = req.query as Record<string, string>;
    res.json({ success: true, data: await financeSummary({ from: q.from, to: q.to, country: q.country }) });
}));

router.get('/finance/withdrawals', requirePermission('finance.read'), ah(async (req, res) => {
    const q = req.query as Record<string, string>;
    const data = await financeWithdrawals({ status: q.status, ageBucket: q.ageBucket, gateway: q.gateway, country: q.country, from: q.from, to: q.to, page: q.page, limit: q.limit });
    res.json({ success: true, data: asPage(data, Number(q.page) || 1, Number(q.limit) || 50) });
}));

router.post('/finance/withdrawals/:transactionId/recheck', requirePermission('finance.recheck'), ah(async (req, res) => {
    const r = await recheckWithdrawal(req.params.transactionId);
    await audit({ actor: actorOf(req), action: 'finance.withdrawal_recheck', target: { type: 'withdrawal', id: req.params.transactionId }, after: { result: r.result, provider: r.provider }, ...reqCtx(req) });
    if (typeof req.body?.caseId === 'string') await cases.recordCheck(req.body.caseId, agentOf(req).id, r).catch(() => undefined);
    res.json({ success: true, data: r });
}));

/**
 * Regularisation request (complete/fail a stuck withdrawal). Needs a reason
 * and evidence; executed by payment-service only after a finance_manager
 * other than the requester approves (approval.regularization = always).
 */
const regularizationRequest = ah(async (req, res) => {
    const b = req.body ?? {};
    const action = b.action === 'complete' || b.action === 'fail' ? b.action : null;
    if (!action) throw badRequest('Action inconnue (complete ou fail).', 'BAD_ACTION');
    const evidence = Array.isArray(b.evidence) ? b.evidence.filter((e: unknown) => typeof e === 'string').map((e: string) => e.slice(0, 500)).slice(0, 10) : [];
    if (!evidence.length) throw badRequest('Joignez au moins une preuve (capture, référence opérateur…).', 'EVIDENCE_REQUIRED');
    const amount = typeof b.amount === 'number' && b.amount >= 0 ? b.amount : undefined;
    const open = await Approval.exists({ type: 'regularization', 'subject.transactionId': req.params.transactionId, status: { $in: ['pending', 'approved'] } });
    if (open) throw conflict('Une régularisation est déjà en cours pour ce retrait.', 'ALREADY_PENDING');
    const a = await createApproval({
        type: 'regularization', requestedBy: ref(req), reason: reason(b.reason),
        payload: { transactionId: req.params.transactionId, action, evidence, amount: amount ?? null },
        subject: { transactionId: req.params.transactionId, userId: typeof b.userId === 'string' ? b.userId : null }, caseId: b.caseId ?? null,
    }, reqCtx(req));
    res.status(201).json({ success: true, data: { approvalId: String(a._id), status: a.status } });
});
router.post('/finance/withdrawals/:transactionId/regularization-requests', requirePermission('finance.regularize.request'), requireReauth, regularizationRequest);
router.post('/finance/withdrawals/:transactionId/regularize', requirePermission('finance.regularize.request'), requireReauth, regularizationRequest);

// ---------- cases ----------
async function caseOut(id: string) {
    const c = await cases.getCase(id);
    return presentCase(c, await agentNames([c.assigneeId]));
}

/** type may be 'finance' (every non-activation type). */
router.get('/cases', requirePermission('cases.work'), ah(async (req, res) => {
    const q = { ...(req.query as Record<string, unknown>) };
    const r = await cases.listCases(q, agentOf(req).id);
    res.json({ success: true, data: { ...r, items: await presentCases(r.items) } });
}));

/** Activation cases are also visible to support agents (activation.check). */
router.get('/cases/:id', ah(async (req, res, next) => {
    const agent = agentOf(req);
    const c = await cases.getCase(req.params.id);
    if (!hasPermission(agent.roles, 'cases.work') && !(c.type === 'activation' && hasPermission(agent.roles, 'activation.check'))) {
        return requirePermission('cases.work')(req, res, next);
    }
    res.json({ success: true, data: presentCase(c, await agentNames([c.assigneeId])) });
}));

router.post('/cases/:id/assign', requirePermission('cases.work'), ah(async (req, res) => {
    const to = req.body?.agentId !== undefined ? req.body.agentId : (req.body?.assigneeId ?? null);
    const r = await cases.assignCase(req.params.id, ref(req), to);
    await audit({ actor: actorOf(req), action: 'case.assigned', target: { type: 'case', id: req.params.id }, before: r.before, after: r.after, ...reqCtx(req) });
    res.json({ success: true, data: await caseOut(req.params.id) });
}));

router.post('/cases/:id/comments', requirePermission('cases.work'), ah(async (req, res) => {
    await cases.commentCase(req.params.id, ref(req), req.body?.body);
    res.json({ success: true, data: await caseOut(req.params.id) });
}));

router.post('/cases/:id/status', requirePermission('cases.work'), ah(async (req, res) => {
    const note = typeof (req.body?.reason ?? req.body?.note) === 'string' ? String(req.body.reason ?? req.body.note).slice(0, 500) : undefined;
    const r = await cases.setCaseStatus(req.params.id, ref(req), req.body?.status, note);
    await audit({ actor: actorOf(req), action: 'case.status', target: { type: 'case', id: req.params.id }, before: r.before, after: r.after, reason: note ?? null, ...reqCtx(req) });
    res.json({ success: true, data: await caseOut(req.params.id) });
}));

/** → RecheckResult (also stored on the case). */
router.post('/cases/:id/recheck', requirePermission('finance.recheck'), ah(async (req, res) => {
    const r = await cases.recheckCase(req.params.id, ref(req));
    await audit({ actor: actorOf(req), action: 'case.recheck', target: { type: 'case', id: req.params.id }, after: { result: r.result.result }, ...reqCtx(req) });
    res.json({ success: true, data: r.result });
}));

export default router;
