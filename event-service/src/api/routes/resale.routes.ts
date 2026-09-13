import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

// POST /api/events/resale/:listingId/buy — initiate purchase of a resale ticket
router.post('/:listingId/buy', notImplemented('buy resale listing'));

export default router;
