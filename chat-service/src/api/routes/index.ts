import { Router } from 'express';
import conversationRoutes from './conversation.routes';
import messageRoutes from './message.routes';
import statusRoutes from './status.routes';

const router = Router();

// Mount routes
router.use('/conversations', conversationRoutes);
router.use('/messages', messageRoutes);
router.use('/statuses', statusRoutes);

export default router;
