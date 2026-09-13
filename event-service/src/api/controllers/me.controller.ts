import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as ticketService from '../../services/ticket.service';
import * as orderService from '../../services/order.service';

export const listMyTickets = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const past = String(req.query.past || '') === 'true';
        const result = await ticketService.listMyTickets(user.userId, {
            past,
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
            skip: req.query.skip ? parseInt(String(req.query.skip), 10) : undefined,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const getMyTicket = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const data = await ticketService.getMyTicket(user.userId, req.params.id);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

export const listMyOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const result = await orderService.listMyOrders(user.userId, {
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
            skip: req.query.skip ? parseInt(String(req.query.skip), 10) : undefined,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};
