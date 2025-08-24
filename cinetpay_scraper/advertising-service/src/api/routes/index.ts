import { Router } from 'express';
import advertisingRouter from './advertising.routes';
// Import other route files here if they exist

const router = Router();

// Mount the advertising routes under /advertising
router.use('/advertising', advertisingRouter);

// Mount other routers here...

export default router; 