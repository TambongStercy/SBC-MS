import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

router.post('/apply', notImplemented('organizer apply'));
router.get('/me', notImplemented('organizer profile'));

router.get('/events', notImplemented('organizer list events'));
router.post('/events', notImplemented('organizer create event'));
router.get('/events/:id', notImplemented('organizer get event'));
router.patch('/events/:id', notImplemented('organizer update event'));
router.post('/events/:id/publish', notImplemented('organizer publish event'));
router.post('/events/:id/suspend', notImplemented('organizer suspend event'));
router.post('/events/:id/cancel', notImplemented('organizer cancel event'));

router.get('/events/:id/ticket-types', notImplemented('organizer list ticket types'));
router.post('/events/:id/ticket-types', notImplemented('organizer create ticket type'));
router.patch('/ticket-types/:id', notImplemented('organizer update ticket type'));

router.get('/events/:id/participants', notImplemented('organizer participants'));
router.get('/events/:id/participants.csv', notImplemented('organizer participants CSV'));

router.get('/dashboard', notImplemented('organizer dashboard'));

export default router;
