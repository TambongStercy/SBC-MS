import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { uploadDocument } from '../middleware/upload.middleware';
import { messageController } from '../controllers/message.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/chat/messages - Send a text message
router.post('/', (req, res) => messageController.sendMessage(req, res));

// POST /api/chat/messages/document - Upload and send document
router.post(
    '/document',
    uploadDocument.single('document'),
    (req, res) => messageController.sendDocumentMessage(req, res)
);

// POST /api/chat/messages/bulk-delete - Bulk delete messages
router.post('/bulk-delete', (req, res) => messageController.bulkDeleteMessages(req, res));

// POST /api/chat/messages/forward - Forward messages to conversations
router.post('/forward', (req, res) => messageController.forwardMessages(req, res));

// GET /api/chat/messages/:id - Get single message
router.get('/:id', (req, res) => messageController.getMessage(req, res));

// GET /api/chat/messages/:id/document-url - Get signed URL for document
// Used when client needs to refresh an expired signed URL
router.get('/:id/document-url', (req, res) => messageController.getDocumentUrl(req, res));

// DELETE /api/chat/messages/:id - Delete message (soft delete)
router.delete('/:id', (req, res) => messageController.deleteMessage(req, res));

export default router;
