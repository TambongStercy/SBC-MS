import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { start, poll, cancel, capacity } from '../controllers/verification.controller';

const router = Router();

router.use(authenticate);

router.get('/capacity', capacity);
router.post('/participations/:participationId/start', start);
router.get('/sessions/:sessionId', poll);
router.delete('/sessions/:sessionId', cancel);

export default router;
