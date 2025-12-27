import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { messageService } from '../../services/message.service';
import { MessageType } from '../../database/models/message.model';
import { settingsServiceClient } from '../../services/clients/settings.service.client';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

const log = logger.getLogger('MessageController');

class MessageController {
    /**
     * Send a text message
     * POST /api/chat/messages
     */
    async sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { conversationId, content, type, replyToId } = req.body;

            if (!conversationId || !content) {
                res.status(400).json({
                    success: false,
                    message: 'conversationId and content are required'
                });
                return;
            }

            if (content.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Message content cannot be empty'
                });
                return;
            }

            const message = await messageService.createMessage({
                conversationId,
                senderId: userId,
                content: content.trim(),
                type: type || MessageType.TEXT,
                replyToId
            });

            res.status(201).json({
                success: true,
                data: message
            });
        } catch (error: any) {
            if (error.message.includes('not a participant')) {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            if (error.message.includes('exceeds maximum length')) {
                res.status(400).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            // Handle message limit error (3 messages max for pending conversations)
            if (error.message.includes('maximum of 3 messages')) {
                res.status(403).json({
                    success: false,
                    message: 'Vous avez atteint le maximum de 3 messages. Le destinataire doit accepter cette conversation avant que vous puissiez envoyer plus de messages.',
                    code: 'MESSAGE_LIMIT_REACHED'
                });
                return;
            }

            // Handle reported/blocked conversation error
            if (error.message.includes('reported or blocked conversation')) {
                res.status(403).json({
                    success: false,
                    message: 'Vous ne pouvez pas envoyer de messages dans une conversation signalée ou bloquée.',
                    code: 'CONVERSATION_BLOCKED'
                });
                return;
            }

            log.error('Error sending message:', error);
            res.status(500).json({
                success: false,
                message: 'Échec de l\'envoi du message'
            });
        }
    }

    /**
     * Send a document message
     * POST /api/chat/messages/document
     */
    async sendDocumentMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { conversationId, content } = req.body;
            const file = req.file;

            if (!conversationId) {
                res.status(400).json({
                    success: false,
                    message: 'conversationId is required'
                });
                return;
            }

            if (!file) {
                res.status(400).json({
                    success: false,
                    message: 'Document file is required'
                });
                return;
            }

            // Upload file to PRIVATE bucket via settings-service
            // Generate unique filename to prevent collisions
            const fileExtension = file.originalname.split('.').pop() || 'bin';
            const uniqueFileName = `${uuidv4()}.${fileExtension}`;

            log.debug(`Uploading document ${file.originalname} to private bucket as ${uniqueFileName}`);

            const uploadResult = await settingsServiceClient.uploadFilePrivate(
                file.buffer,
                file.mimetype,
                uniqueFileName,
                'chat-documents' // folder in private bucket
            );

            // Store the GCS path (gs://bucket/path) - NOT a public URL
            // Signed URLs will be generated when messages are retrieved
            const documentUrl = uploadResult.gcsPath;

            const message = await messageService.createMessage({
                conversationId,
                senderId: userId,
                content: content || file.originalname,
                type: MessageType.DOCUMENT,
                documentUrl,
                documentName: file.originalname,
                documentMimeType: file.mimetype,
                documentSize: file.size
            });

            // Generate a signed URL for immediate response so client can display the document
            let signedUrl: string | undefined;
            try {
                signedUrl = await settingsServiceClient.getSignedUrl(documentUrl, 3600); // 1 hour
            } catch (signedUrlError) {
                log.warn('Failed to generate signed URL for new document:', signedUrlError);
            }

            // Return message with signed URL for immediate use
            const responseData = message.toObject ? message.toObject() : message;
            if (signedUrl) {
                (responseData as any).documentSignedUrl = signedUrl;
            }

            res.status(201).json({
                success: true,
                data: responseData
            });
        } catch (error: any) {
            if (error.message.includes('not a participant')) {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            if (error.message.includes('upload failed') || error.message.includes('File upload')) {
                log.error('Error uploading document to storage:', error);
                res.status(500).json({
                    success: false,
                    message: 'Failed to upload document. Please try again.'
                });
                return;
            }

            log.error('Error sending document message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send document'
            });
        }
    }

    /**
     * Get a single message
     * GET /api/chat/messages/:id
     */
    async getMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const message = await messageService.getMessage(id, userId);

            if (!message) {
                res.status(404).json({
                    success: false,
                    message: 'Message not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: message
            });
        } catch (error: any) {
            log.error('Error getting message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get message'
            });
        }
    }

    /**
     * Delete a message
     * DELETE /api/chat/messages/:id
     */
    async deleteMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const message = await messageService.deleteMessage(id, userId);

            if (!message) {
                res.status(404).json({
                    success: false,
                    message: 'Message not found or you are not the sender'
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Message deleted'
            });
        } catch (error: any) {
            log.error('Error deleting message:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete message'
            });
        }
    }

    /**
     * Bulk delete messages
     * POST /api/chat/messages/bulk-delete
     */
    async bulkDeleteMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { messageIds } = req.body;

            if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'messageIds array is required'
                });
                return;
            }

            const deletedCount = await messageService.bulkDeleteMessages(messageIds, userId);

            res.status(200).json({
                success: true,
                message: `${deletedCount} messages deleted`
            });
        } catch (error: any) {
            log.error('Error bulk deleting messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete messages'
            });
        }
    }

    /**
     * Forward messages to conversations
     * POST /api/chat/messages/forward
     */
    async forwardMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { messageIds, targetConversationIds } = req.body;

            if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'messageIds array is required'
                });
                return;
            }

            if (!targetConversationIds || !Array.isArray(targetConversationIds) || targetConversationIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'targetConversationIds array is required'
                });
                return;
            }

            const forwardedCount = await messageService.forwardMessages(messageIds, targetConversationIds, userId);

            res.status(200).json({
                success: true,
                message: `${forwardedCount} messages forwarded`
            });
        } catch (error: any) {
            if (error.message.includes('not a participant')) {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            log.error('Error forwarding messages:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to forward messages'
            });
        }
    }

    /**
     * Get signed URL for a message's document
     * GET /api/chat/messages/:id/document-url
     * Used when clients need to refresh an expired signed URL
     */
    async getDocumentUrl(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const signedUrl = await messageService.getDocumentSignedUrl(id, userId);

            if (!signedUrl) {
                res.status(404).json({
                    success: false,
                    message: 'Document not found or access denied'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: {
                    signedUrl,
                    expiresIn: 3600 // 1 hour in seconds
                }
            });
        } catch (error: any) {
            log.error('Error getting document URL:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get document URL'
            });
        }
    }
}

export const messageController = new MessageController();
