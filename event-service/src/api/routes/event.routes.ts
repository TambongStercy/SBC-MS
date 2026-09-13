import { Router } from 'express';
import * as eventController from '../controllers/event.controller';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// GET /api/tickets/public/events — list published events
router.get('/events', eventController.listPublicEvents);

// GET /api/tickets/public/events/:slug — event detail with ticket types
router.get('/events/:slug', eventController.getPublicEventBySlug);

// GET /api/tickets/public/resale — global resale marketplace list (V1 stub)
router.get('/resale', notImplemented('resale marketplace list'));

export default router;
