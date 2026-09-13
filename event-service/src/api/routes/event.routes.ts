import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// GET /api/events/public/events — list published events (filters: city,category,dateFrom,dateTo,priceMin,priceMax,q)
router.get('/events', notImplemented('list published events'));

// GET /api/events/public/events/:slug — event detail with ticket types + resale snapshot
router.get('/events/:slug', notImplemented('event detail by slug'));

// GET /api/events/public/resale — global resale marketplace list
router.get('/resale', notImplemented('resale marketplace list'));

export default router;
