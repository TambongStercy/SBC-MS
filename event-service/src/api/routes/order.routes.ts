import { Router } from 'express';
import * as orderController from '../controllers/order.controller';

const router = Router();

router.post('/', orderController.createOrder);
router.get('/:id', orderController.getOrder);

export default router;
