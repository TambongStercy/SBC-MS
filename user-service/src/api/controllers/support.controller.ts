import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import {
    getSupportDetails, searchSupportMembers, supportContactChange, SupportError, SupportCallContext,
    SUPPORT_DETAILS_MAX_IDS, supportAuthenticatorReset, supportFreeze, supportMomoChange, areRelatedMembers,
} from '../../services/support.service';
import logger from '../../utils/logger';

const log = logger.getLogger('SupportController');

/** Contract §2 headers, for the owner-side logs. Header values are clipped: they are only logged. */
function callContext(req: Request): SupportCallContext {
    const h = (name: string) => {
        const v = req.headers[name];
        return typeof v === 'string' ? v.slice(0, 120) : undefined;
    };
    return { requestId: h('x-request-id'), actor: h('x-support-actor'), caller: h('x-service-name') };
}

function fail(res: Response, status: number, code: string, message: string) {
    res.status(status).json({ success: false, code, message });
}

function handleError(res: Response, err: any, what: string) {
    if (err instanceof SupportError) {
        fail(res, err.statusCode, err.code, err.message);
        return;
    }
    log.error(`${what} failed: ${err?.message ?? err}`);
    fail(res, 500, 'INTERNAL_ERROR', `${what} failed.`);
}

/**
 * Owner endpoints for SBC Support (docs/support/CONTRACT.md §2.1), mounted on
 * the internal serviceRouter (service secret required).
 */
export const supportController = {
    /** POST /api/users/internal/support-details { userIds: string[] (≤ 100) } */
    async details(req: Request, res: Response): Promise<void> {
        const { userIds } = req.body ?? {};
        if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > SUPPORT_DETAILS_MAX_IDS) {
            return fail(res, 400, 'INVALID_INPUT', `userIds must be an array of 1 to ${SUPPORT_DETAILS_MAX_IDS} ids.`);
        }
        if (!userIds.every(id => typeof id === 'string' && isValidObjectId(id))) {
            return fail(res, 400, 'INVALID_INPUT', 'userIds contains an invalid id.');
        }
        try {
            const data = await getSupportDetails(userIds);
            const c = callContext(req);
            log.info(`support-details n=${userIds.length} found=${data.length} requestId=${c.requestId ?? '-'} actor=${c.actor ?? '-'}`);
            res.status(200).json({ success: true, data });
        } catch (err) {
            handleError(res, err, 'support-details');
        }
    },

    /** POST /api/users/internal/support-search { q: string, limit?: number (≤ 20) } */
    async search(req: Request, res: Response): Promise<void> {
        const { q, limit } = req.body ?? {};
        if (typeof q !== 'string' || !q.trim()) return fail(res, 400, 'INVALID_INPUT', 'q is required.');
        try {
            const data = await searchSupportMembers(q, limit);
            const c = callContext(req);
            log.info(`support-search hits=${data.length} requestId=${c.requestId ?? '-'} actor=${c.actor ?? '-'}`);
            res.status(200).json({ success: true, data });
        } catch (err) {
            handleError(res, err, 'support-search');
        }
    },

    /**
     * POST /api/users/internal/support/contact-change
     * { userId, field: 'email'|'phoneNumber', newValue, step: 'send-code'|'apply', code?, approvalId }
     */
    async contactChange(req: Request, res: Response): Promise<void> {
        const { userId, field, newValue, step, code, approvalId } = req.body ?? {};
        if (typeof userId !== 'string' || !isValidObjectId(userId)) return fail(res, 400, 'INVALID_INPUT', 'userId is invalid.');
        if (field !== 'email' && field !== 'phoneNumber') return fail(res, 400, 'INVALID_INPUT', "field must be 'email' or 'phoneNumber'.");
        if (step !== 'send-code' && step !== 'apply') return fail(res, 400, 'INVALID_INPUT', "step must be 'send-code' or 'apply'.");
        if (typeof newValue !== 'string' || !newValue.trim()) return fail(res, 400, 'INVALID_INPUT', 'newValue is required.');
        if (typeof approvalId !== 'string' || !approvalId.trim() || approvalId.length > 100) {
            return fail(res, 400, 'APPROVAL_REQUIRED', 'approvalId is required.');
        }
        if (step === 'apply' && (typeof code !== 'string' || !code.trim())) return fail(res, 400, 'INVALID_INPUT', 'code is required.');
        try {
            const data = await supportContactChange({ userId, field, newValue, step, code, approvalId: approvalId.trim() }, callContext(req));
            res.status(200).json({ success: true, data });
        } catch (err) {
            handleError(res, err, 'support contact-change');
        }
    },

    // ─── Security plan Phase 5 ───

    /** POST /api/users/internal/support/related { userId, otherUserId } → { related } */
    async related(req: Request, res: Response): Promise<void> {
        const { userId, otherUserId } = req.body ?? {};
        if (![userId, otherUserId].every(v => typeof v === 'string' && isValidObjectId(v))) return fail(res, 400, 'INVALID_INPUT', 'userId and otherUserId are required.');
        try {
            res.status(200).json({ success: true, data: { related: await areRelatedMembers(userId, otherUserId) } });
        } catch (err) {
            handleError(res, err, 'support/related');
        }
    },

    /** POST /api/users/internal/support/authenticator-reset { userId, reason, approvalId } */
    async authenticatorReset(req: Request, res: Response): Promise<void> {
        const { userId, reason, approvalId } = req.body ?? {};
        if (typeof userId !== 'string' || !isValidObjectId(userId)) return fail(res, 400, 'INVALID_INPUT', 'userId is invalid.');
        try {
            res.status(200).json({ success: true, data: await supportAuthenticatorReset({ userId, reason, approvalId }, callContext(req)) });
        } catch (err) {
            handleError(res, err, 'support/authenticator-reset');
        }
    },

    /** POST /api/users/internal/support/freeze { userId, action: 'freeze'|'unfreeze', reason, approvalId } */
    async freeze(req: Request, res: Response): Promise<void> {
        const { userId, action, reason, approvalId } = req.body ?? {};
        if (typeof userId !== 'string' || !isValidObjectId(userId)) return fail(res, 400, 'INVALID_INPUT', 'userId is invalid.');
        if (action !== 'freeze' && action !== 'unfreeze') return fail(res, 400, 'INVALID_INPUT', "action must be 'freeze' or 'unfreeze'.");
        try {
            res.status(200).json({ success: true, data: await supportFreeze({ userId, action, reason, approvalId }, callContext(req)) });
        } catch (err) {
            handleError(res, err, 'support/freeze');
        }
    },

    /** POST /api/users/internal/support/momo-change { userId, momoNumber, momoOperator, approvalId } */
    async momoChange(req: Request, res: Response): Promise<void> {
        const { userId, momoNumber, momoOperator, approvalId } = req.body ?? {};
        if (typeof userId !== 'string' || !isValidObjectId(userId)) return fail(res, 400, 'INVALID_INPUT', 'userId is invalid.');
        try {
            res.status(200).json({ success: true, data: await supportMomoChange({ userId, momoNumber, momoOperator, approvalId }, callContext(req)) });
        } catch (err) {
            handleError(res, err, 'support/momo-change');
        }
    },
};
