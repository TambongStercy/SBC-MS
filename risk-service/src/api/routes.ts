import { Router } from 'express';
import mongoose from 'mongoose';
import { decide, memberView } from '../services/decision.service';
import { RiskMemberModel } from '../database/models';
import { redis } from '../lib/redis';
import { requireService } from './service-auth';
import { enqueue, kycStatus, kycView } from '../services/kyc.service';

const ID = /^[a-f0-9]{24}$/i;

export function routes(): Router {
    const r = Router();

    r.get('/health', async (_req, res) => {
        const mongo = mongoose.connection.readyState === 1;
        let redisOk: boolean | null = null;
        const c = redis();
        if (c) { try { redisOk = (await c.ping()) === 'PONG'; } catch { redisOk = false; } }
        res.status(mongo ? 200 : 503).json({ status: mongo ? 'ok' : 'degraded', service: 'risk-service', mongo, redis: redisOk });
    });

    /** POST /api/risk/internal/decision {userId, action, amount?, currency?, transactionId?} */
    r.post('/api/risk/internal/decision', requireService, async (req, res) => {
        const { userId, action, amount, currency, transactionId } = req.body ?? {};
        if (typeof userId !== 'string' || !ID.test(userId) || typeof action !== 'string' || !/^[a-z_]{3,32}$/.test(action)) {
            return res.status(400).json({ success: false, message: 'userId and action are required' });
        }
        const a = await decide({
            userId, action,
            amount: Number.isFinite(Number(amount)) ? Number(amount) : undefined,
            currency: typeof currency === 'string' ? currency.slice(0, 8) : undefined,
            transactionId: typeof transactionId === 'string' ? transactionId.slice(0, 64) : undefined,
            caller: String(req.header('x-service-name') || '').slice(0, 40) || undefined,
        });
        return res.json({ success: true, data: a });
    });

    /** GET /api/risk/internal/members/:userId: score, reasons, linked accounts (support desk). */
    r.get('/api/risk/internal/members/:userId', requireService, async (req, res) => {
        if (!ID.test(req.params.userId)) return res.status(400).json({ success: false, message: 'bad userId' });
        const [view, kyc] = await Promise.all([memberView(req.params.userId), kycView(req.params.userId)]);
        return res.json({ success: true, data: { ...view, kyc } });
    });

    /**
     * POST /api/risk/internal/members/flags {userIds: string[] (≤ 2000)}:
     * the members among them that the engine does not simply allow
     * (require_code / hold), for user-service's nightly dormant-accounts pass.
     */
    r.post('/api/risk/internal/members/flags', requireService, async (req, res) => {
        const ids = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((x: unknown) => typeof x === 'string' && ID.test(x)) : null;
        if (!ids || ids.length > 2000) return res.status(400).json({ success: false, message: 'userIds: 1 to 2000 ids' });
        const rows = await RiskMemberModel.find({ userId: { $in: ids }, decision: { $ne: 'allow' } }, { _id: 0, userId: 1, decision: 1, score: 1 }).lean();
        return res.json({ success: true, data: rows });
    });

    /**
     * POST /api/risk/internal/kyc/hint {userId, reason: signup|contact_change}: queue a level 1
     * check (Phase 8). user-service calls it without waiting; it only writes the queue.
     */
    r.post('/api/risk/internal/kyc/hint', requireService, async (req, res) => {
        const { userId, reason } = req.body ?? {};
        if (typeof userId !== 'string' || !ID.test(userId) || (reason !== 'signup' && reason !== 'contact_change' && reason !== 'manual')) {
            return res.status(400).json({ success: false, message: 'userId and reason (signup | contact_change | manual) are required' });
        }
        await enqueue([userId], reason);
        return res.status(202).json({ success: true });
    });

    /** GET /api/risk/internal/kyc/status: queue size, results, bands (no member data). */
    r.get('/api/risk/internal/kyc/status', requireService, async (_req, res) => res.json({ success: true, data: await kycStatus() }));

    return r;
}
