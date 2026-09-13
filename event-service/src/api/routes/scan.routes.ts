import { Router } from 'express';
import * as scanController from '../controllers/scan.controller';

const router = Router();

// POST /api/tickets/scan — organizer scans a QR token; server validates + records CheckIn.
router.post('/', scanController.scan);

export default router;
