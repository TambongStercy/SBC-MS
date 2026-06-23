import { Router } from 'express';
import { profileController } from '../controllers/profile.controller';
import { matchController } from '../controllers/match.controller';
import { authenticate } from '../middleware/auth.middleware';
import { enforceModuleWindow } from '../middleware/module-window.middleware';
import { photoUpload } from '../middleware/upload.middleware';

const router = Router();

// All profile routes require an authenticated SBC member.
router.use(authenticate);

// === Self profile management (allowed anytime — not window-gated) ===
router.post('/', (req, res, next) => profileController.createProfile(req, res, next));
router.get('/me', (req, res, next) => profileController.getMyProfile(req, res, next));
router.put('/me', (req, res, next) => profileController.updateProfile(req, res, next));
router.post('/me/photos', photoUpload.array('photos'), (req, res, next) => profileController.uploadPhotos(req, res, next));

// === Browsing & interactions (window-gated) ===
router.get('/', enforceModuleWindow, (req, res, next) => profileController.browse(req, res, next));
router.get('/:id', enforceModuleWindow, (req, res, next) => profileController.getProfile(req, res, next));
router.post('/:id/interest', enforceModuleWindow, (req, res, next) => profileController.expressInterest(req, res, next));

// === Moderation (allowed anytime) ===
router.post('/:id/report', (req, res, next) => matchController.reportProfile(req, res, next));
router.post('/:id/block', (req, res, next) => matchController.blockProfile(req, res, next));

export default router;
