import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { start, poll, cancel, capacity } from '../controllers/verification.controller';
import { issueCode, uploadVideo, manualStatus } from '../controllers/manual-verification.controller';

const router = Router();

router.use(authenticate);

router.get('/capacity', capacity);
router.post('/participations/:participationId/start', start);
router.get('/sessions/:sessionId', poll);
router.delete('/sessions/:sessionId', cancel);

// Manual (video-proof) verification — fallback for when the WhatsApp auto-connect
// fails. Issue an on-screen code, then upload a screen recording within the window.
router.post('/participations/:participationId/manual/code', issueCode);
router.post('/participations/:participationId/manual/video', uploadVideo);
router.get('/participations/:participationId/manual/status', manualStatus);

export default router;
