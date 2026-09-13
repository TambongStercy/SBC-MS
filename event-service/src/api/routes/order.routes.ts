import { Router } from 'express';
import { notImplemented } from '../controllers/placeholder.controller';

const router = Router();

router.post('/', notImplemented('create order + payment intent'));
router.get('/:id', notImplemented('order status'));

export default router;
