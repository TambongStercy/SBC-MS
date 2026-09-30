import { Router } from 'express';
import * as scanController from '../controllers/scan.controller';
import { scanLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// POST /api/tickets/scan — organizer scans a QR token; server validates + records CheckIn.
// Rate-limited per user: prevents an abusive/misconfigured scanner from
// hammering us (spec §27).
router.post('/', scanLimiter, scanController.scan);

export default router;
