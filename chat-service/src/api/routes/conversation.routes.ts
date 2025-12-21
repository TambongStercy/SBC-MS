import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { conversationController } from '../controllers/conversation.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/chat/conversations - List user's conversations
router.get('/', (req, res) => conversationController.listConversations(req, res));

// GET /api/chat/conversations/archived - List user's archived conversations
router.get('/archived', (req, res) => conversationController.listArchivedConversations(req, res));

// POST /api/chat/conversations - Create or get existing conversation
router.post('/', (req, res) => conversationController.createOrGetConversation(req, res));

// POST /api/chat/conversations/bulk-delete - Bulk delete conversations
router.post('/bulk-delete', (req, res) => conversationController.bulkDeleteConversations(req, res));

// GET /api/chat/conversations/:id - Get conversation by ID
router.get('/:id', (req, res) => conversationController.getConversation(req, res));

// GET /api/chat/conversations/:id/messages - Get messages in conversation
router.get('/:id/messages', (req, res) => conversationController.getMessages(req, res));

// DELETE /api/chat/conversations/:id - Delete conversation (for user)
// @deprecated - Use POST /:id/archive instead for better UX terminology
router.delete('/:id', (req, res) => conversationController.deleteConversation(req, res));

// POST /api/chat/conversations/:id/archive - Archive conversation (hide from list)
router.post('/:id/archive', (req, res) => conversationController.archiveConversation(req, res));

// POST /api/chat/conversations/:id/unarchive - Unarchive conversation (restore to list)
router.post('/:id/unarchive', (req, res) => conversationController.unarchiveConversation(req, res));

// PATCH /api/chat/conversations/:id/read - Mark all messages as read
router.patch('/:id/read', (req, res) => conversationController.markAsRead(req, res));

// POST /api/chat/conversations/:id/accept - Accept a conversation
router.post('/:id/accept', (req, res) => conversationController.acceptConversation(req, res));

// POST /api/chat/conversations/:id/report - Report a conversation
router.post('/:id/report', (req, res) => conversationController.reportConversation(req, res));

export default router;
