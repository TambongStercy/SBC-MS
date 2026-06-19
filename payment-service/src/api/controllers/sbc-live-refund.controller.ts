import { Request, Response } from 'express';
import { sbcLiveRefundService } from '../../services/sbc-live-refund.service';
import { RefundStatus } from '../../database/models/sbc-live-refund.model';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('SbcLiveRefundController');

class SbcLiveRefundController {
    /**
     * SSO client requests a refund for one of its past payments.
     * @route POST /api/payments/sso/refund-requests
     * @access Bearer SSO access token with payments.write scope (enforced via middleware)
     */
    requestRefund = async (req: Request, res: Response) => {
        const token = req.ssoToken;
        if (!token) {
            return res.status(401).json({ success: false, message: 'SSO authentication required' });
        }
        const { sessionId, refundAmount, reason, clientReference } = req.body || {};
        if (!sessionId || !reason || typeof refundAmount !== 'number') {
            return res.status(400).json({ success: false, message: 'sessionId, refundAmount (number), and reason are required' });
        }
        try {
            const refund = await sbcLiveRefundService.requestRefund({
                sessionId,
                ssoClientId: token.client_id,
                clientReference: clientReference || null,
                refundAmount,
                reason,
                requestedBy: 'sso_client',
                requestedByUserId: token.sub,
            });
            return res.status(201).json({ success: true, data: this.serializeRefund(refund) });
        } catch (error: any) {
            log.warn(`Refund request failed: ${error.message}`);
            const status = error instanceof AppError ? error.statusCode : 500;
            return res.status(status).json({ success: false, message: error.message });
        }
    };

    /**
     * Admin lists refund requests, optionally filtered by status.
     * @route GET /api/payments/admin/sbc-live-refunds?status=PENDING_REVIEW
     * @access Admin
     */
    listRefunds = async (req: Request, res: Response) => {
        try {
            const status = req.query.status as RefundStatus | undefined;
            const ssoClientId = req.query.ssoClientId as string | undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const skip = req.query.skip ? Number(req.query.skip) : undefined;
            const refunds = await sbcLiveRefundService.listRefunds({ status, ssoClientId, limit, skip });
            return res.status(200).json({ success: true, data: refunds.map((r) => this.serializeRefund(r)) });
        } catch (error: any) {
            log.error(`Listing refunds failed: ${error.message}`);
            return res.status(500).json({ success: false, message: error.message });
        }
    };

    /**
     * Admin approves or rejects a pending refund.
     * @route POST /api/payments/admin/sbc-live-refunds/:id/decision
     * @access Admin
     * @body  { decision: 'approve' | 'reject', note?: string }
     */
    decideRefund = async (req: Request, res: Response) => {
        const adminUserId = (req as any).user?.userId;
        if (!adminUserId) {
            return res.status(401).json({ success: false, message: 'Admin authentication required' });
        }
        const { id } = req.params;
        const { decision, note } = req.body || {};
        if (decision !== 'approve' && decision !== 'reject') {
            return res.status(400).json({ success: false, message: "decision must be 'approve' or 'reject'" });
        }
        try {
            const refund = await sbcLiveRefundService.decideRefund({
                refundId: id,
                adminUserId,
                decision,
                note,
            });
            return res.status(200).json({ success: true, data: this.serializeRefund(refund) });
        } catch (error: any) {
            log.error(`Refund decision failed for ${id}: ${error.message}`);
            const status = error instanceof AppError ? error.statusCode : 500;
            return res.status(status).json({ success: false, message: error.message });
        }
    };

    private serializeRefund(r: any) {
        return {
            id: r._id?.toString(),
            originalPaymentIntentSessionId: r.originalPaymentIntentSessionId,
            ssoClientId: r.ssoClientId,
            clientReference: r.clientReference,
            buyerUserId: r.buyerUserId?.toString(),
            creatorUserId: r.creatorUserId?.toString() || null,
            grossAmount: r.grossAmount,
            refundAmount: r.refundAmount,
            creatorClawbackAmount: r.creatorClawbackAmount,
            sbcCommissionReturnedAmount: r.sbcCommissionReturnedAmount,
            currency: r.currency,
            reason: r.reason,
            status: r.status,
            requestedBy: r.requestedBy,
            requestedByUserId: r.requestedByUserId?.toString() || null,
            decidedAt: r.decidedAt,
            decidedByAdminId: r.decidedByAdminId?.toString() || null,
            decisionNote: r.decisionNote,
            completedAt: r.completedAt,
            failureReason: r.failureReason,
            refundTransactionId: r.refundTransactionId?.toString() || null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        };
    }
}

export const sbcLiveRefundController = new SbcLiveRefundController();
export default sbcLiveRefundController;
