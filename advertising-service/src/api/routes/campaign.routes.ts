import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    getQuote,
    reach,
    create,
    listMine,
    getOne,
    getPerformance,
    decideUnfilled,
    getLeaderboard,
    update,
    submit,
    pay,
    cancel,
    pause,
    resume,
} from '../controllers/campaign.controller';

const router = Router();

router.use(authenticate);

router.get('/quote', getQuote);
// Live as the annonceur edits their filters, so an unservable audience is caught
// before payment rather than after.
router.post('/reach', reach);
// Before /:id so 'leaderboard' is not read as a campaign id.
router.get('/leaderboard', getLeaderboard);
router.post('/', create);
router.get('/', listMine);
router.get('/:id', getOne);
router.patch('/:id', update);
router.post('/:id/submit', submit);
router.post('/:id/pay', pay);
router.post('/:id/cancel', cancel);
router.post('/:id/pause', pause);
router.post('/:id/resume', resume);
router.get('/:id/performance', getPerformance);
router.post('/:id/decide', decideUnfilled);

export default router;
