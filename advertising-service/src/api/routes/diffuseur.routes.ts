import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    getEligibility,
    enroll,
    getMyProfile,
    listMyParticipations,
} from '../controllers/diffuseur.controller';

const router = Router();

router.use(authenticate);

router.get('/eligibility', getEligibility);
router.post('/enroll', enroll);
router.get('/me', getMyProfile);
router.get('/me/participations', listMyParticipations);

export default router;
