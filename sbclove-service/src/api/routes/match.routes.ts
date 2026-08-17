import { Router } from 'express';
import { matchController } from '../controllers/match.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

// GET /matches/me - the "Mes matchs" space (spec §12)
router.get('/me', (req, res, next) => matchController.getMyMatches(req, res, next));

// POST /matches/:id/contact-choice - double opt-in choice (spec §13)
router.post('/:id/contact-choice', (req, res, next) => matchController.setContactChoice(req, res, next));

export default router;
