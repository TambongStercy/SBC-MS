import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// POST /api/events/scan — organizer scans a QR token; server validates + records CheckIn.
router.post('/', notImplemented('scan QR'));

export default router;
