import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    getQuote,
    create,
    listMine,
    getOne,
    getPerformance,
    decideUnfilled,
    getLeaderboard,
    update,
    submit,
} from '../controllers/campaign.controller';

const router = Router();

router.use(authenticate);

router.get('/quote', getQuote);
// Before /:id so 'leaderboard' is not read as a campaign id.
router.get('/leaderboard', getLeaderboard);
router.post('/', create);
router.get('/', listMine);
router.get('/:id', getOne);
router.patch('/:id', update);
router.post('/:id/submit', submit);
router.get('/:id/performance', getPerformance);
router.post('/:id/decide', decideUnfilled);

export default router;
