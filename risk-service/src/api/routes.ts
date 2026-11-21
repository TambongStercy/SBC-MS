import { Router } from 'express';
import mongoose from 'mongoose';
import { decide, memberView } from '../services/decision.service';
import { redis } from '../lib/redis';
import { requireService } from './service-auth';

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
        return res.json({ success: true, data: await memberView(req.params.userId) });
    });

    return r;
}
