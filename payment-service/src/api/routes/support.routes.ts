import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requireServiceCaller } from '../middleware/auth.middleware';
import { supportFinanceService } from '../../services/support-finance.service';
import { describeCommission, reverseCommission } from '../../services/commission-reversal.service';
import logger from '../../utils/logger';

/**
 * SBC Support → payment-service (contract §2.2), mounted at /api/internal/support.
 * Service secret only (constant-time compare). Every call is logged with its
 * x-request-id and, for agent actions, x-support-actor.
 *
 *   GET  /members/:userId/payins?limit=20
 *   GET  /members/:userId/withdrawals?limit=20
 *   GET  /payins/lookup?ref=&userId=
 *   POST /payins/:sessionId/recheck
 *   POST /withdrawals/:transactionId/recheck
 *   POST /withdrawals/:transactionId/regularize   { action: 'complete'|'fail', reason, evidence: string[], approvalId }
 *   POST /activation/manual                       { userId, gateway, externalRef, plan, approvalId, countryCode? }
 *   GET  /finance/summary?from&to&country&gateway
 *   GET  /finance/withdrawals?status&ageBucket&gateway&country&from&to&page&limit
 *   GET  /commissions/:transactionId?userId=        a commission, and whether it can be taken back
 *   POST /commissions/:transactionId/reverse         { userId, reason, approvalId }  (services/commission-reversal.service.ts)
 */
const router = Router();
const log = logger.getLogger('SupportRoutes');

router.use(requireServiceCaller);
router.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming) ? incoming : randomUUID();
    (req as any).requestId = requestId;
    (req as any).supportActor = (req.header('x-support-actor') || '').slice(0, 120) || null;
    res.setHeader('x-request-id', requestId);
    log.info(`[${requestId}] ${req.method} ${req.path} from ${req.header('x-service-name') || 'unknown'} actor=${(req as any).supportActor ?? '-'}`);
    next();
});

const rid = (req: Request): string => (req as any).requestId;
const actor = (req: Request): string | null => (req as any).supportActor;

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
        await fn(req, res);
    } catch (error: any) {
        const status = error.statusCode || 500;
        if (status >= 500) log.error(`[${rid(req)}] ${req.method} ${req.path} failed: ${error.message}`);
        res.status(status).json({
            success: false,
            code: error.code || (status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
            message: status >= 500 ? 'Internal error' : error.message,
            ...(error.data ? { data: error.data } : {}),
        });
    }
};

const bad = (res: Response, message: string, code = 'BAD_REQUEST') => res.status(400).json({ success: false, code, message });
const parseDate = (v: unknown): Date | undefined => {
    if (typeof v !== 'string' || !v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
};

router.get('/members/:userId/payins', handle(async (req, res) => {
    res.json({ success: true, data: await supportFinanceService.memberPayins(req.params.userId, Number(req.query.limit) || 20) });
}));

router.get('/members/:userId/withdrawals', handle(async (req, res) => {
    res.json({ success: true, data: await supportFinanceService.memberWithdrawals(req.params.userId, Number(req.query.limit) || 20) });
}));

router.get('/payins/lookup', handle(async (req, res) => {
    const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
    if (!ref) return bad(res, 'ref is required');
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
    const data = await supportFinanceService.lookupPayin(ref, userId);
    if (!data) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Payment not found' });
    res.json({ success: true, data });
}));

router.post('/payins/:sessionId/recheck', handle(async (req, res) => {
    res.json({ success: true, data: await supportFinanceService.recheckPayin(req.params.sessionId, rid(req)) });
}));

router.post('/withdrawals/:transactionId/recheck', handle(async (req, res) => {
    res.json({ success: true, data: await supportFinanceService.recheckWithdrawal(req.params.transactionId, rid(req)) });
}));

router.post('/withdrawals/:transactionId/regularize', handle(async (req, res) => {
    const { action, reason, evidence, approvalId } = req.body || {};
    if (action !== 'complete' && action !== 'fail') return bad(res, "action must be 'complete' or 'fail'");
    if (typeof reason !== 'string' || reason.trim().length < 5) return bad(res, 'reason is required (5 characters or more)');
    if (typeof approvalId !== 'string' || !approvalId.trim()) return bad(res, 'approvalId is required', 'APPROVAL_REQUIRED');
    if (!Array.isArray(evidence) || !evidence.length || evidence.length > 20 || !evidence.every((e) => typeof e === 'string' && e.length <= 500)) {
        return bad(res, 'evidence must list 1 to 20 references (strings)');
    }
    if (!actor(req)) return bad(res, 'x-support-actor header is required', 'ACTOR_REQUIRED');
    const data = await supportFinanceService.regularizeWithdrawal({
        transactionId: req.params.transactionId, action, reason: reason.trim().slice(0, 1000), evidence,
        approvalId: approvalId.trim().slice(0, 200), actor: actor(req)!, requestId: rid(req),
    });
    res.json({ success: true, data });
}));

router.post('/activation/manual', handle(async (req, res) => {
    const { userId, gateway, externalRef, plan, approvalId, countryCode } = req.body || {};
    if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) return bad(res, 'userId is required');
    if (typeof gateway !== 'string' || !gateway) return bad(res, 'gateway is required');
    if (typeof externalRef !== 'string' || !externalRef.trim() || externalRef.length > 200) return bad(res, 'externalRef is required');
    if (typeof plan !== 'string' || !plan) return bad(res, 'plan is required');
    if (typeof approvalId !== 'string' || !approvalId.trim()) return bad(res, 'approvalId is required', 'APPROVAL_REQUIRED');
    if (!actor(req)) return bad(res, 'x-support-actor header is required', 'ACTOR_REQUIRED');
    const data = await supportFinanceService.manualActivation({
        userId, gateway, externalRef: externalRef.trim(), plan, approvalId: approvalId.trim().slice(0, 200),
        actor: actor(req)!, requestId: rid(req), countryCode: typeof countryCode === 'string' ? countryCode.toUpperCase() : undefined,
    });
    res.status(201).json({ success: true, data });
}));

router.get('/finance/summary', handle(async (req, res) => {
    const from = parseDate(req.query.from) ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = parseDate(req.query.to);
    const country = typeof req.query.country === 'string' && /^[A-Za-z]{2}$/.test(req.query.country) ? req.query.country : undefined;
    const gateway = typeof req.query.gateway === 'string' && /^[A-Za-z]{2,20}$/.test(req.query.gateway) ? req.query.gateway : undefined;
    res.json({ success: true, data: await supportFinanceService.financeSummary({ from, to, country, gateway }) });
}));

router.get('/finance/withdrawals', handle(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const ageBucket = str(req.query.ageBucket);
    if (ageBucket && !['<24h', '24-48h', '48-72h', '>72h'].includes(ageBucket)) return bad(res, 'ageBucket must be <24h, 24-48h, 48-72h or >72h');
    res.json({
        success: true,
        data: await supportFinanceService.financeWithdrawals({
            status: str(req.query.status), ageBucket, gateway: str(req.query.gateway),
            country: str(req.query.country)?.slice(0, 2), from: parseDate(req.query.from), to: parseDate(req.query.to),
            page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50,
        }),
    });
}));

// Commission reversal (support approval `commission_reversal`, 2026-11-23).
router.get('/commissions/:transactionId', handle(async (req, res) => {
    const userId = String(req.query.userId || '');
    if (!/^[a-f0-9]{24}$/i.test(userId)) return bad(res, 'userId is required');
    const c = await describeCommission(req.params.transactionId, userId);
    if (!c) return res.status(404).json({ success: false, code: 'COMMISSION_NOT_FOUND', message: 'Transaction introuvable pour ce membre.' });
    res.status(200).json({ success: true, data: c });
}));

router.post('/commissions/:transactionId/reverse', handle(async (req, res) => {
    const { userId, reason, approvalId } = req.body || {};
    if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) return bad(res, 'userId is required');
    if (typeof reason !== 'string' || reason.trim().length < 5) return bad(res, 'reason is required (5 characters or more)');
    if (typeof approvalId !== 'string' || !approvalId.trim()) return bad(res, 'approvalId is required', 'APPROVAL_REQUIRED');
    if (!actor(req)) return bad(res, 'x-support-actor header is required', 'ACTOR_REQUIRED');
    const data = await reverseCommission({
        transactionId: req.params.transactionId, userId, reason: reason.trim().slice(0, 1000),
        by: actor(req)!, approvalId: approvalId.trim().slice(0, 200),
    });
    log.info(`[${rid(req)}] commission ${req.params.transactionId} ${data.status} by ${actor(req)}`);
    res.status(200).json({ success: true, data });
}));

export default router;
