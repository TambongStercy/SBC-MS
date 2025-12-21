import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { uploadMedia } from '../middleware/upload.middleware';
import { statusController } from '../controllers/status.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/chat/statuses - Get status feed with filters
router.get('/', (req, res) => statusController.getStatusFeed(req, res));

// GET /api/chat/statuses/categories - Get category definitions
router.get('/categories', (req, res) => statusController.getCategories(req, res));

// POST /api/chat/statuses - Create new status
router.post(
    '/',
    uploadMedia.single('media'),
    (req, res) => statusController.createStatus(req, res)
);

// GET /api/chat/statuses/my-statuses - Get current user's own statuses
router.get('/my-statuses', (req, res) => statusController.getMyStatuses(req, res));

// GET /api/chat/statuses/user/:userId - Get statuses by specific user
router.get('/user/:userId', (req, res) => statusController.getUserStatuses(req, res));

// GET /api/chat/statuses/:id - Get single status
router.get('/:id', (req, res) => statusController.getStatus(req, res));

// DELETE /api/chat/statuses/:id - Delete status
router.delete('/:id', (req, res) => statusController.deleteStatus(req, res));

// POST /api/chat/statuses/:id/like - Like status
router.post('/:id/like', (req, res) => statusController.likeStatus(req, res));

// DELETE /api/chat/statuses/:id/like - Unlike status
router.delete('/:id/like', (req, res) => statusController.unlikeStatus(req, res));

// POST /api/chat/statuses/:id/repost - Repost status
router.post('/:id/repost', (req, res) => statusController.repostStatus(req, res));

// POST /api/chat/statuses/:id/reply - Start conversation from status reply
router.post('/:id/reply', (req, res) => statusController.replyToStatus(req, res));

// POST /api/chat/statuses/:id/view - Increment view count
router.post('/:id/view', (req, res) => statusController.incrementView(req, res));

// GET /api/chat/statuses/:id/interactions - Get likes/reposts list
router.get('/:id/interactions', (req, res) => statusController.getInteractions(req, res));

export default router;
