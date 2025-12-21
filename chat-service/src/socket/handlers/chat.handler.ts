import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../socket.server';
import { messageService } from '../../services/message.service';
import { conversationService } from '../../services/conversation.service';
import { presenceService } from '../../services/presence.service';
import { MessageType } from '../../database/models/message.model';
import logger from '../../utils/logger';

const log = logger.getLogger('ChatHandler');

export function chatHandler(io: Server, socket: AuthenticatedSocket) {
    // Join conversation room
    socket.on('conversation:join', async (conversationId: string) => {
        try {
            // Verify user is participant
            const isParticipant = await conversationService.isParticipant(
                conversationId,
                socket.userId
            );

            if (isParticipant) {
                socket.join(`conversation:${conversationId}`);
                log.debug(`User ${socket.userId} joined conversation ${conversationId}`);

                // Mark messages as read when joining
                await conversationService.markAsRead(conversationId, socket.userId);
            } else {
                socket.emit('error', { message: 'Not a participant in this conversation' });
            }
        } catch (error: any) {
            log.error('Error joining conversation:', error);
            socket.emit('error', { message: 'Failed to join conversation' });
        }
    });

    // Leave conversation room
    socket.on('conversation:leave', (conversationId: string) => {
        socket.leave(`conversation:${conversationId}`);
        log.debug(`User ${socket.userId} left conversation ${conversationId}`);
    });

    // Send message
    socket.on('message:send', async (data: {
        conversationId: string;
        content: string;
        type?: MessageType;
        documentUrl?: string;
        documentName?: string;
        documentMimeType?: string;
        documentSize?: number;
    }) => {
        try {
            if (!data.conversationId || !data.content) {
                socket.emit('message:error', { error: 'conversationId and content are required' });
                return;
            }

            const message = await messageService.createMessage({
                conversationId: data.conversationId,
                senderId: socket.userId,
                content: data.content.trim(),
                type: data.type || MessageType.TEXT,
                documentUrl: data.documentUrl,
                documentName: data.documentName,
                documentMimeType: data.documentMimeType,
                documentSize: data.documentSize
            });

            // Get message with sender info
            const messageWithSender = await messageService.getMessage(
                message._id.toString(),
                socket.userId
            );

            // Broadcast to conversation room
            io.to(`conversation:${data.conversationId}`).emit('message:new', messageWithSender);

            // Also emit to individual user rooms for participants not in room
            const participants = await conversationService.getParticipants(data.conversationId);
            for (const participantId of participants) {
                if (participantId !== socket.userId) {
                    io.to(`user:${participantId}`).emit('message:notification', {
                        message: messageWithSender,
                        conversationId: data.conversationId
                    });
                }
            }

            // Acknowledge to sender
            socket.emit('message:sent', {
                messageId: message._id.toString(),
                status: 'sent',
                createdAt: message.createdAt
            });

            log.debug(`Message sent in conversation ${data.conversationId} by ${socket.userId}`);
        } catch (error: any) {
            log.error('Error sending message:', error);
            socket.emit('message:error', { error: error.message || 'Failed to send message' });
        }
    });

    // Mark messages as read
    socket.on('message:read', async (data: { conversationId: string; messageIds?: string[] }) => {
        try {
            if (data.messageIds && data.messageIds.length > 0) {
                await messageService.markAsRead(data.messageIds, socket.userId);
            } else {
                await conversationService.markAsRead(data.conversationId, socket.userId);
            }

            // Notify other participants that messages were read
            io.to(`conversation:${data.conversationId}`).emit('message:read', {
                conversationId: data.conversationId,
                messageIds: data.messageIds,
                readBy: socket.userId,
                readAt: new Date()
            });
        } catch (error: any) {
            log.error('Error marking messages as read:', error);
        }
    });

    // Typing indicator start
    socket.on('typing:start', async (conversationId: string) => {
        try {
            await presenceService.setTyping(conversationId, socket.userId);

            socket.to(`conversation:${conversationId}`).emit('typing:start', {
                userId: socket.userId,
                userName: socket.userName,
                conversationId
            });
        } catch (error: any) {
            log.error('Error setting typing indicator:', error);
        }
    });

    // Typing indicator stop
    socket.on('typing:stop', async (conversationId: string) => {
        try {
            await presenceService.clearTyping(conversationId, socket.userId);

            socket.to(`conversation:${conversationId}`).emit('typing:stop', {
                userId: socket.userId,
                conversationId
            });
        } catch (error: any) {
            log.error('Error clearing typing indicator:', error);
        }
    });

    // Get online status for users
    socket.on('presence:check', async (userIds: string[]) => {
        try {
            const statuses = await presenceService.getOnlineStatuses(userIds);
            const result: Record<string, boolean> = {};
            statuses.forEach((isOnline, oderId) => {
                result[oderId] = isOnline;
            });

            socket.emit('presence:status', result);
        } catch (error: any) {
            log.error('Error checking presence:', error);
        }
    });
}
