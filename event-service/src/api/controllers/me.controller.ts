import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as ticketService from '../../services/ticket.service';
import * as orderService from '../../services/order.service';
import * as disputeService from '../../services/dispute.service';

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

export const openDispute = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const dispute = await disputeService.openDispute({
            complainantUserId: user.userId,
            kind: req.body?.kind,
            description: req.body?.description,
            ticketId: req.body?.ticketId,
            resaleOrderId: req.body?.resaleOrderId,
        });
        res.status(201).json({ success: true, data: dispute });
    } catch (err) { next(err); }
};

export const listMyDisputes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const items = await disputeService.listMyDisputes(user.userId);
        res.json({ success: true, data: items });
    } catch (err) { next(err); }
};
