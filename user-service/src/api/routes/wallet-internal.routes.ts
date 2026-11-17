import { Router, Request, Response } from 'express';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { balanceReservationService } from '../../services/balance-reservation.service';
import { walletLedger } from '../../services/wallet-ledger.service';
import WalletMovementModel, { WalletMovementStatus } from '../../database/models/wallet-movement.model';
import logger from '../../utils/logger';

/**
 * Wallet internals for payment-service (service secret only), mounted at
 * /api/users/internal/wallet:
 *
 *   POST /reservations                       { transactionId, userId, amount, currency }  reserve
 *   GET  /reservations/:transactionId                                                   read
 *   POST /reservations/:transactionId/release { reason }                                release (failure, rejection, expiry, cancellation)
 *   POST /reservations/:transactionId/convert { userId, amount, currency, description }  payout confirmed: debit once
 *   GET  /available/:userId                                                             balance, debt, reserved, available
 *   POST /movements/lookup                   { references: string[] }                   applied ledger movements
 *   GET  /movements?referencePrefix=&since=&limit=                                       applied movements (reconciliation)
 *
 * All keyed by transactionId / reference and idempotent.
 */
const router = Router();
const log = logger.getLogger('WalletInternalRoutes');

router.use(authenticateServiceRequest);

const fail = (res: Response, status: number, code: string, message: string) =>
    res.status(status).json({ success: false, code, message });

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
        await fn(req, res);
    } catch (error: any) {
        log.error(`${req.method} ${req.originalUrl} failed: ${error.message}`);
        fail(res, error.statusCode || 500, 'WALLET_ERROR', error.statusCode ? error.message : 'Wallet operation failed');
    }
};

router.post('/reservations', handle(async (req, res) => {
    const { transactionId, userId, amount, currency } = req.body || {};
    const out = await balanceReservationService.reserve({
        transactionId: String(transactionId || ''), userId: String(userId || ''), amount: Number(amount), currency: currency || 'XAF',
    });
    switch (out.status) {
        case 'reserved': return res.status(201).json({ success: true, data: { status: out.status, reservation: out.reservation } });
        case 'already_reserved': return res.status(200).json({ success: true, data: { status: out.status, reservation: out.reservation } });
        case 'insufficient': return fail(res, 409, 'INSUFFICIENT_AVAILABLE_BALANCE', 'Solde disponible insuffisant.');
        case 'user_not_found': return fail(res, 404, 'USER_NOT_FOUND', 'User not found');
        default: return res.status(409).json({ success: false, code: 'RESERVATION_CONFLICT', message: out.reason, data: { reservation: out.reservation } });
    }
}));

router.get('/reservations/:transactionId', handle(async (req, res) => {
    const reservation = await balanceReservationService.get(req.params.transactionId);
    if (!reservation) return fail(res, 404, 'NOT_RESERVED', 'No reservation for this transaction');
    res.status(200).json({ success: true, data: reservation });
}));

router.post('/reservations/:transactionId/release', handle(async (req, res) => {
    const out = await balanceReservationService.release(req.params.transactionId, String(req.body?.reason || 'released'));
    if (out.status === 'conflict') {
        return res.status(409).json({ success: false, code: 'RESERVATION_CONFLICT', message: out.reason, data: { reservation: out.reservation } });
    }
    res.status(200).json({ success: true, data: out });
}));

router.post('/reservations/:transactionId/convert', handle(async (req, res) => {
    const { userId, amount, currency, description } = req.body || {};
    const out = await balanceReservationService.convert({
        transactionId: req.params.transactionId, userId: String(userId || ''), amount: Number(amount), currency: currency || 'XAF',
        description: typeof description === 'string' ? description.slice(0, 500) : undefined,
    });
    if (out.status === 'conflict') {
        return res.status(409).json({ success: false, code: 'CONVERSION_CONFLICT', message: out.reason, data: { reservation: out.reservation } });
    }
    res.status(200).json({ success: true, data: out });
}));

router.get('/available/:userId', handle(async (req, res) => {
    const out = await balanceReservationService.available(req.params.userId);
    if (!out) return fail(res, 404, 'USER_NOT_FOUND', 'User not found');
    res.status(200).json({ success: true, data: out });
}));

router.post('/movements/lookup', handle(async (req, res) => {
    const refs = Array.isArray(req.body?.references) ? req.body.references.filter((r: unknown) => typeof r === 'string').slice(0, 500) : [];
    res.status(200).json({ success: true, data: await walletLedger.findApplied(refs) });
}));

router.get('/movements', handle(async (req, res) => {
    const prefix = typeof req.query.referencePrefix === 'string' ? req.query.referencePrefix : '';
    if (!/^[a-z-]+:$/.test(prefix)) return fail(res, 400, 'BAD_PREFIX', 'referencePrefix like "withdrawal:" is required');
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    const rows = await WalletMovementModel.find({
        reference: { $regex: `^${prefix}` }, status: WalletMovementStatus.APPLIED, appliedAt: { $gte: since },
    }).sort({ appliedAt: 1 }).limit(limit).select('reference direction amount currency userId appliedAt source -_id').lean();
    res.status(200).json({ success: true, data: rows });
}));

export default router;
