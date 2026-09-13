import { Request, Response, NextFunction } from 'express';
import * as eventService from '../../services/event.service';

const parseInt10 = (s: any, fallback: number) => {
    const n = parseInt(String(s ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
};

export const listPublicEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { q, city, category, dateFrom, dateTo, priceMin, priceMax, limit, skip } = req.query;
        const result = await eventService.listPublicEvents({
            q: q as string | undefined,
            city: city as string | undefined,
            category: category as string | undefined,
            dateFrom: dateFrom ? new Date(String(dateFrom)) : undefined,
            dateTo: dateTo ? new Date(String(dateTo)) : undefined,
            priceMin: priceMin ? parseFloat(String(priceMin)) : undefined,
            priceMax: priceMax ? parseFloat(String(priceMax)) : undefined,
            limit: parseInt10(limit, 20),
            skip: parseInt10(skip, 0),
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const getPublicEventBySlug = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await eventService.getPublicEventBySlug(req.params.slug);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};
