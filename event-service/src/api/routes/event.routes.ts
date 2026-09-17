import { Router } from 'express';
import * as eventController from '../controllers/event.controller';
import * as resaleController from '../controllers/resale.controller';

const router = Router();

// GET /api/tickets/public/events — list published events
router.get('/events', eventController.listPublicEvents);

// GET /api/tickets/public/events/:slug — event detail with ticket types
router.get('/events/:slug', eventController.getPublicEventBySlug);

// GET /api/tickets/public/resale — global resale marketplace list
router.get('/resale', resaleController.listPublicResale);

export default router;
