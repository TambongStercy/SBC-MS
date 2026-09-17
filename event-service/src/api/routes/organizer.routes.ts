import { Router } from 'express';
import * as organizerController from '../controllers/organizer.controller';
import { requireApprovedOrganizer } from '../middleware/organizer.middleware';

const router = Router();

// Application + own status — do NOT gate on approval, or a pending user can't
// see whether their application was accepted.
router.post('/apply', organizerController.apply);
router.get('/me', organizerController.getMe);

// Approved-organizer-only from here on
router.use(requireApprovedOrganizer);

router.get('/events', organizerController.listEvents);
router.post('/events', organizerController.createEvent);
router.get('/events/:id', organizerController.getEvent);
router.patch('/events/:id', organizerController.updateEvent);
router.post('/events/:id/publish', organizerController.publishEvent);
router.post('/events/:id/suspend', organizerController.suspendEvent);
router.post('/events/:id/cancel', organizerController.cancelEvent);

router.get('/events/:id/ticket-types', organizerController.listTicketTypes);
router.post('/events/:id/ticket-types', organizerController.createTicketType);

router.get('/events/:id/participants', organizerController.listParticipants);
router.get('/events/:id/participants.csv', organizerController.exportParticipantsCsv);

router.get('/dashboard', organizerController.dashboard);
router.get('/finances', organizerController.finances);

export default router;
