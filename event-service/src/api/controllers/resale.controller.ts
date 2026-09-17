import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as resaleService from '../../services/resale.service';

export const listMyListings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const listings = await resaleService.listMyListings(user.userId);
        res.json({ success: true, data: listings });
    } catch (err) { next(err); }
};

export const createListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const { ticketId } = req.params;
        const { askingPrice } = req.body || {};
        const listing = await resaleService.createListing({
            sellerUserId: user.userId,
            ticketId,
            askingPrice: Number(askingPrice),
        });
        res.status(201).json({ success: true, data: listing });
    } catch (err) { next(err); }
};

export const cancelListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const listing = await resaleService.cancelListing(user.userId, req.params.listingId);
        res.json({ success: true, data: listing });
    } catch (err) { next(err); }
};

export const listPublicResale = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await resaleService.listPublicResale({
            eventId: req.query.eventId as string | undefined,
            limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
            skip: req.query.skip ? parseInt(String(req.query.skip), 10) : undefined,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const buyListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const { holder } = req.body || {};
        const result = await resaleService.buyListing({
            buyerUserId: user.userId,
            listingId: req.params.listingId,
            holder,
        });
        res.status(201).json({
            success: true,
            data: {
                orderId: result.order._id,
                resaleOrderId: result.resaleOrder._id,
                paymentSessionId: result.paymentSession.sessionId,
                total: result.order.total,
            },
        });
    } catch (err) { next(err); }
};
