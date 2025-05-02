import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';

const router = Router();
const adminRouter = Router();

// --- Admin Product Routes --- 
// Define and mount admin routes FIRST
adminRouter.use(authenticate);
adminRouter.use(authorize(['admin']));

adminRouter.get('/', productController.adminListProducts); // GET /api/products/admin
adminRouter.patch('/:productId/status', productController.updateProductStatus); // PATCH /api/products/admin/:productId/status
adminRouter.delete('/:productId/hard', productController.adminHardDeleteProduct); // DELETE /api/products/admin/:productId/hard
adminRouter.patch('/:productId/restore', productController.adminRestoreProduct); // PATCH /api/products/admin/:productId/restore

// Mount the admin router under the /admin path
router.use('/admin', adminRouter);



router.get('/user', authenticate, productController.getUserProducts);
router.get('/user/ratings', authenticate, productController.getUserRatings);
router.post('/', authenticate, upload.array('images', 10), productController.createProduct);
router.put('/:productId', authenticate, upload.array('images', 10), productController.updateProduct);
router.delete('/:productId', authenticate, productController.deleteProduct);
router.post('/:productId/ratings', authenticate, productController.rateProduct);
router.delete('/ratings/:ratingId', authenticate, productController.deleteRating);
router.post('/ratings/:ratingId/helpful', authenticate, productController.markRatingAsHelpful);


// --- Public Product Routes ---
// Define these AFTER the more specific /admin routes
router.get('/search', productController.searchProducts);
router.get('/:productId', productController.getProduct);
router.get('/:productId/ratings', productController.getProductRatings);


export default router; 