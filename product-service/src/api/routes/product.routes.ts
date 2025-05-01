import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

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

// --- Public Product Routes ---
// Define these AFTER the more specific /admin routes
router.get('/search', productController.searchProducts);
router.get('/:productId', productController.getProduct);
router.get('/:productId/ratings', productController.getProductRatings);

// --- Authenticated User Routes --- 
// Apply authentication middleware for subsequent general user actions
router.use(authenticate);

router.get('/user', productController.getUserProducts);
router.get('/user/ratings', productController.getUserRatings);
router.post('/', productController.createProduct);
router.put('/:productId', productController.updateProduct);
router.delete('/:productId', productController.deleteProduct);
router.post('/:productId/ratings', productController.rateProduct);
router.delete('/ratings/:ratingId', productController.deleteRating);
router.post('/ratings/:ratingId/helpful', productController.markRatingAsHelpful);

export default router; 