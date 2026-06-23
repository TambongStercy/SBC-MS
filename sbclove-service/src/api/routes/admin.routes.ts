import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authenticate, authorizeAdmin } from '../middleware/auth.middleware';

const router = Router();

// All admin routes require an authenticated admin.
router.use(authenticate);
router.use(authorizeAdmin);

// Profile validation queue (spec §8)
router.get('/profiles', (req, res, next) => adminController.listProfiles(req, res, next));
router.patch('/profiles/:id/validate', (req, res, next) => adminController.validateProfile(req, res, next));

// Reports management (spec §14)
router.get('/reports', (req, res, next) => adminController.listReports(req, res, next));
router.patch('/reports/:id', (req, res, next) => adminController.reviewReport(req, res, next));

// Module config + global kill-switch (spec §14)
router.get('/module', (req, res, next) => adminController.getModuleConfig(req, res, next));
router.patch('/module', (req, res, next) => adminController.updateModuleConfig(req, res, next));

export default router;
