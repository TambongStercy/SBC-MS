import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    getQuote,
    create,
    listMine,
    getOne,
    getPerformance,
    decideUnfilled,
} from '../controllers/campaign.controller';

const router = Router();

router.use(authenticate);

router.get('/quote', getQuote);
router.post('/', create);
router.get('/', listMine);
router.get('/:id', getOne);
router.get('/:id/performance', getPerformance);
router.post('/:id/decide', decideUnfilled);

export default router;
