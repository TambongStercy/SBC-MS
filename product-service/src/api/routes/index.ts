import { Router } from 'express';
import flashSaleRoutes from './flashsale.routes';
import productRoutes from './product.routes';

const router = Router();

router.use('/flash-sales', flashSaleRoutes);
router.use('/products', productRoutes);

export default router; 