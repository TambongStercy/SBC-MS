import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as orderService from '../../services/order.service';

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const { eventId, items, holder } = req.body || {};
        const result = await orderService.createPrimaryOrder({
            userId: user.userId,
            eventId,
            items,
            holder,
        });
        res.status(201).json({
            success: true,
            data: {
                orderId: result.order._id,
                paymentSessionId: result.paymentSession.sessionId,
                total: result.order.total,
            },
        });
    } catch (err) { next(err); }
};

export const getOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const order = await orderService.getOrder(user.userId, req.params.id);
        res.json({ success: true, data: order });
    } catch (err) { next(err); }
};
