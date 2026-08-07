import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    getEligibility,
    enroll,
    getMyProfile,
    listMyParticipations,
    acceptParticipation,
    declineParticipation,
    markPosted,
} from '../controllers/diffuseur.controller';

const router = Router();

router.use(authenticate);

router.get('/eligibility', getEligibility);
router.post('/enroll', enroll);
router.get('/me', getMyProfile);
router.get('/me/participations', listMyParticipations);
router.post('/participations/:id/accept', acceptParticipation);
router.post('/participations/:id/decline', declineParticipation);
router.post('/participations/:id/mark-posted', markPosted);

export default router;
