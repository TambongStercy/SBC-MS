import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { conversationService } from '../../services/conversation.service';
import { messageService } from '../../services/message.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ConversationController');

class ConversationController {
    /**
     * Get user's conversations
     * GET /api/chat/conversations
     */
    async listConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await conversationService.getUserConversations(userId, page, limit);

            res.status(200).json({
                success: true,
                data: result.conversations,
                pagination: {
                    currentPage: page,
                    totalPages: result.totalPages,
                    totalCount: result.total,
                    limit
                }
            });
        } catch (error: any) {
            log.error('Error listing conversations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get conversations'
            });
        }
    }

    /**
     * List archived conversations
     * GET /api/chat/conversations/archived
     */
    async listArchivedConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await conversationService.getArchivedConversations(userId, page, limit);

            res.status(200).json({
                success: true,
                data: {
                    conversations: result.conversations,
                    pagination: {
                        page,
                        limit,
                        total: result.total,
                        totalPages: result.totalPages
                    }
                }
            });
        } catch (error: any) {
            log.error('Error listing archived conversations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get archived conversations'
            });
        }
    }

    /**
     * Create or get existing conversation
     * POST /api/chat/conversations
     */
    async createOrGetConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { participantId } = req.body;

            if (!participantId) {
                res.status(400).json({
                    success: false,
                    message: 'participantId is required'
                });
                return;
            }

            if (participantId === userId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot create conversation with yourself'
                });
                return;
            }

            const conversation = await conversationService.getOrCreateDirectConversation(
                userId,
                participantId
            );

            // Get full conversation details
            const conversationDetails = await conversationService.getConversationById(
                conversation._id.toString(),
                userId
            );

            res.status(200).json({
                success: true,
                data: conversationDetails
            });
        } catch (error: any) {
            log.error('Error creating conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create conversation'
            });
        }
    }

    /**
     * Get conversation by ID
     * GET /api/chat/conversations/:id
     */
    async getConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const conversation = await conversationService.getConversationById(id, userId);

            if (!conversation) {
                res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: conversation
            });
        } catch (error: any) {
            log.error('Error getting conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get conversation'
            });
        }
    }

    /**
     * Get messages in conversation
     * GET /api/chat/conversations/:id/messages?groupByDate=true
     */
    async getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const groupByDate = req.query.groupByDate === 'true';

            if (groupByDate) {
                // Return messages grouped by date
                const result = await messageService.getConversationMessagesGrouped(id, userId, page, limit);

                res.status(200).json({
                    success: true,
                    data: result.messageGroups,
                    pagination: {
                        currentPage: page,
                        totalPages: result.totalPages,
                        totalCount: result.total,
                        limit
                    }
                });
            } else {
                // Return flat list of messages
                const result = await messageService.getConversationMessages(id, userId, page, limit);

                res.status(200).json({
                    success: true,
                    data: result.messages,
                    pagination: {
                        currentPage: page,
                        totalPages: result.totalPages,
                        totalCount: result.total,
                        limit
                    }
                });
            }
        } catch (error: any) {
            if (error.message === 'User is not a participant in this conversation') {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error getting messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get messages'
            });
        }
    }

    /**
     * Delete conversation for user
     * DELETE /api/chat/conversations/:id
     */
    async deleteConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            // Verify user is participant
            const isParticipant = await conversationService.isParticipant(id, userId);
            if (!isParticipant) {
                res.status(403).json({
                    success: false,
                    message: 'Not a participant in this conversation'
                });
                return;
            }

            await conversationService.deleteForUser(id, userId);

            res.status(200).json({
                success: true,
                message: 'Conversation deleted'
            });
        } catch (error: any) {
            log.error('Error deleting conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete conversation'
            });
        }
    }

    /**
     * Archive conversation for user (hide from list)
     * POST /api/chat/conversations/:id/archive
     */
    async archiveConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            // Verify user is participant
            const isParticipant = await conversationService.isParticipant(id, userId);
            if (!isParticipant) {
                res.status(403).json({
                    success: false,
                    message: 'Not a participant in this conversation'
                });
                return;
            }

            await conversationService.deleteForUser(id, userId);

            res.status(200).json({
                success: true,
                message: 'Conversation archived'
            });
        } catch (error: any) {
            log.error('Error archiving conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to archive conversation'
            });
        }
    }

    /**
     * Unarchive conversation for user (restore to list)
     * POST /api/chat/conversations/:id/unarchive
     */
    async unarchiveConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            // Verify user is participant
            const isParticipant = await conversationService.isParticipant(id, userId);
            if (!isParticipant) {
                res.status(403).json({
                    success: false,
                    message: 'Not a participant in this conversation'
                });
                return;
            }

            await conversationService.restoreForUser(id, userId);

            res.status(200).json({
                success: true,
                message: 'Conversation unarchived'
            });
        } catch (error: any) {
            log.error('Error unarchiving conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to unarchive conversation'
            });
        }
    }

    /**
     * Mark all messages as read
     * PATCH /api/chat/conversations/:id/read
     */
    async markAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            // Verify user is participant
            const isParticipant = await conversationService.isParticipant(id, userId);
            if (!isParticipant) {
                res.status(403).json({
                    success: false,
                    message: 'Not a participant in this conversation'
                });
                return;
            }

            const count = await conversationService.markAsRead(id, userId);

            res.status(200).json({
                success: true,
                message: `Marked ${count} messages as read`
            });
        } catch (error: any) {
            log.error('Error marking as read:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to mark as read'
            });
        }
    }

    /**
     * Bulk delete conversations for user
     * POST /api/chat/conversations/bulk-delete
     */
    async bulkDeleteConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { conversationIds } = req.body;

            if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'conversationIds array is required'
                });
                return;
            }

            let deletedCount = 0;
            for (const conversationId of conversationIds) {
                // Verify user is participant before deleting
                const isParticipant = await conversationService.isParticipant(conversationId, userId);
                if (isParticipant) {
                    await conversationService.deleteForUser(conversationId, userId);
                    deletedCount++;
                }
            }

            res.status(200).json({
                success: true,
                message: `${deletedCount} conversations deleted`
            });
        } catch (error: any) {
            log.error('Error bulk deleting conversations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete conversations'
            });
        }
    }

    /**
     * Accept a conversation
     * POST /api/chat/conversations/:id/accept
     */
    async acceptConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            await conversationService.acceptConversation(id, userId);

            res.status(200).json({
                success: true,
                message: 'Conversation accepted'
            });
        } catch (error: any) {
            if (error.message === 'Not a participant in this conversation') {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error accepting conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to accept conversation'
            });
        }
    }

    /**
     * Report a conversation
     * POST /api/chat/conversations/:id/report
     */
    async reportConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            await conversationService.reportConversation(id, userId);

            res.status(200).json({
                success: true,
                message: 'Conversation reported'
            });
        } catch (error: any) {
            if (error.message === 'Not a participant in this conversation') {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error reporting conversation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to report conversation'
            });
        }
    }
}

export const conversationController = new ConversationController();
