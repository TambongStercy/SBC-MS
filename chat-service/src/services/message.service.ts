import { Types } from 'mongoose';
import { messageRepository } from '../database/repositories/message.repository';
import { conversationRepository } from '../database/repositories/conversation.repository';
import { IMessage, MessageType, MessageStatus } from '../database/models/message.model';
import { conversationService } from './conversation.service';
import { userServiceClient } from './clients/user.service.client';
import { settingsServiceClient } from './clients/settings.service.client';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('MessageService');

export interface CreateMessageData {
    conversationId: string;
    senderId: string;
    content: string;
    type?: MessageType;
    documentUrl?: string;
    documentName?: string;
    documentMimeType?: string;
    documentSize?: number;
    replyToId?: string;
}

export interface MessageWithSender extends IMessage {
    sender?: {
        _id: string;
        name: string;
        avatar?: string;
    };
    documentSignedUrl?: string; // Signed URL for private document access
}

export interface MessageGroup {
    date: string; // ISO date string (YYYY-MM-DD)
    dateLabel: string; // Human-readable label (e.g., "Today", "Yesterday", "Dec 15, 2025")
    messages: MessageWithSender[];
}

/**
 * Group messages by date
 */
function groupMessagesByDate(messages: MessageWithSender[]): MessageGroup[] {
    const groups = new Map<string, MessageWithSender[]>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Group messages by date
    for (const message of messages) {
        const messageDate = new Date(message.createdAt);
        messageDate.setHours(0, 0, 0, 0);
        const dateKey = messageDate.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!groups.has(dateKey)) {
            groups.set(dateKey, []);
        }
        groups.get(dateKey)!.push(message);
    }

    // Convert to array and add labels
    const result: MessageGroup[] = [];
    for (const [dateKey, msgs] of groups.entries()) {
        const msgDate = new Date(dateKey);
        msgDate.setHours(0, 0, 0, 0);

        let dateLabel: string;
        if (msgDate.getTime() === today.getTime()) {
            dateLabel = 'Today';
        } else if (msgDate.getTime() === yesterday.getTime()) {
            dateLabel = 'Yesterday';
        } else {
            // Format: Dec 15, 2025
            dateLabel = msgDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }

        result.push({
            date: dateKey,
            dateLabel,
            messages: msgs
        });
    }

    // Sort by date (oldest first, matching message order)
    result.sort((a, b) => a.date.localeCompare(b.date));

    return result;
}

class MessageService {
    /**
     * Create a new message
     */
    async createMessage(data: CreateMessageData): Promise<IMessage> {
        // Validate content length
        if (data.content.length > config.message.maxContentLength) {
            throw new Error(`Message content exceeds maximum length of ${config.message.maxContentLength} characters`);
        }

        // Verify user is participant
        const isParticipant = await conversationService.isParticipant(
            data.conversationId,
            data.senderId
        );
        if (!isParticipant) {
            throw new Error('User is not a participant in this conversation');
        }

        // Check 3-message limit for unaccepted conversations
        await conversationService.checkMessageLimit(data.conversationId, data.senderId);

        // Get reply info if replying to a message
        let replyTo;
        if (data.replyToId) {
            const replyMessage = await messageRepository.findById(data.replyToId);
            if (replyMessage) {
                const replyUser = await userServiceClient.getUserDetails(replyMessage.senderId.toString());
                replyTo = {
                    messageId: replyMessage._id,
                    content: replyMessage.content.substring(0, 100),
                    senderId: replyMessage.senderId,
                    senderName: replyUser?.name || 'Unknown',
                    type: replyMessage.type
                };
            }
        }

        // Create message
        const message = await messageRepository.create({
            conversationId: new Types.ObjectId(data.conversationId),
            senderId: new Types.ObjectId(data.senderId),
            content: data.content,
            type: data.type || MessageType.TEXT,
            documentUrl: data.documentUrl,
            documentName: data.documentName,
            documentMimeType: data.documentMimeType,
            documentSize: data.documentSize,
            status: MessageStatus.SENT,
            readBy: [new Types.ObjectId(data.senderId)], // Sender has "read" their own message
            deliveredTo: [new Types.ObjectId(data.senderId)],
            replyTo
        });

        // Restore conversation for sender if they had deleted it
        // This makes the conversation reappear in their chat list
        await conversationService.restoreForUser(data.conversationId, data.senderId);

        // Update conversation
        const participants = await conversationService.getParticipants(data.conversationId);
        const otherParticipants = participants.filter(p => p !== data.senderId);

        await conversationService.updateLastMessage(
            data.conversationId,
            message._id,
            message.senderId,
            data.content,
            otherParticipants
        );

        // Increment message count for the sender
        await conversationService.incrementMessageCount(data.conversationId, data.senderId);

        log.debug(`Message created in conversation ${data.conversationId} by ${data.senderId}`);

        return message;
    }

    /**
     * Get messages in a conversation
     */
    async getConversationMessages(
        conversationId: string,
        userId: string,
        page: number = 1,
        limit: number = 50
    ): Promise<{ messages: MessageWithSender[]; total: number; totalPages: number }> {
        // Verify user is participant
        const isParticipant = await conversationService.isParticipant(conversationId, userId);
        if (!isParticipant) {
            throw new Error('User is not a participant in this conversation');
        }

        const { messages, total } = await messageRepository.getConversationMessages(
            conversationId,
            userId,
            page,
            limit
        );

        // Get sender details
        const senderIds = [...new Set(messages.map(m => m.senderId.toString()))];
        const userDetails = await userServiceClient.getMultipleUsers(senderIds);

        // Add sender details to messages
        const messagesWithSenders: MessageWithSender[] = messages.map(message => {
            const msg = message.toObject() as MessageWithSender;
            const sender = userDetails.get(message.senderId.toString());
            msg.sender = sender ? {
                _id: sender._id,
                name: sender.name,
                avatar: sender.avatar
            } : undefined;
            return msg;
        });

        // Generate signed URLs for document messages stored in private bucket
        await this.attachSignedUrlsToMessages(messagesWithSenders);

        return {
            messages: messagesWithSenders,
            total,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Get messages in a conversation grouped by date
     */
    async getConversationMessagesGrouped(
        conversationId: string,
        userId: string,
        page: number = 1,
        limit: number = 50
    ): Promise<{ messageGroups: MessageGroup[]; total: number; totalPages: number }> {
        const { messages, total, totalPages } = await this.getConversationMessages(
            conversationId,
            userId,
            page,
            limit
        );

        const messageGroups = groupMessagesByDate(messages);

        return {
            messageGroups,
            total,
            totalPages
        };
    }

    /**
     * Mark messages as read
     */
    async markAsRead(messageIds: string[], userId: string): Promise<void> {
        await messageRepository.markAsRead(messageIds, userId);
        log.debug(`User ${userId} marked ${messageIds.length} messages as read`);
    }

    /**
     * Mark messages as delivered
     */
    async markAsDelivered(messageIds: string[], userId: string): Promise<void> {
        await messageRepository.markAsDelivered(messageIds, userId);
    }

    /**
     * Delete a message
     */
    async deleteMessage(messageId: string, userId: string): Promise<IMessage | null> {
        const message = await messageRepository.softDelete(messageId, userId);

        if (message) {
            log.info(`User ${userId} deleted message ${messageId}`);
        }

        return message;
    }

    /**
     * Get a single message
     */
    async getMessage(messageId: string, userId: string): Promise<MessageWithSender | null> {
        const message = await messageRepository.findById(messageId);

        if (!message) {
            return null;
        }

        // Verify user is participant in the conversation
        const isParticipant = await conversationService.isParticipant(
            message.conversationId.toString(),
            userId
        );
        if (!isParticipant) {
            return null;
        }

        // Get sender details
        const sender = await userServiceClient.getUserDetails(message.senderId.toString());

        const messageWithSender = message.toObject() as MessageWithSender;
        messageWithSender.sender = sender ? {
            _id: sender._id,
            name: sender.name,
            avatar: sender.avatar
        } : undefined;

        return messageWithSender;
    }

    /**
     * Get unread count for a conversation
     */
    async getUnreadCount(conversationId: string, userId: string): Promise<number> {
        return messageRepository.getUnreadCount(conversationId, userId);
    }

    /**
     * Bulk delete messages
     */
    async bulkDeleteMessages(messageIds: string[], userId: string): Promise<number> {
        let deletedCount = 0;
        for (const messageId of messageIds) {
            const result = await messageRepository.softDelete(messageId, userId);
            if (result) {
                deletedCount++;
            }
        }
        log.info(`User ${userId} bulk deleted ${deletedCount} messages`);
        return deletedCount;
    }

    /**
     * Forward messages to other conversations
     */
    async forwardMessages(
        messageIds: string[],
        targetConversationIds: string[],
        userId: string
    ): Promise<number> {
        // Get the original messages
        const messages = await Promise.all(
            messageIds.map(id => messageRepository.findById(id))
        );
        const validMessages = messages.filter(m => m !== null);

        if (validMessages.length === 0) {
            throw new Error('No valid messages to forward');
        }

        // Verify user is participant in all target conversations
        for (const convId of targetConversationIds) {
            const isParticipant = await conversationService.isParticipant(convId, userId);
            if (!isParticipant) {
                throw new Error(`User is not a participant in conversation ${convId}`);
            }
        }

        let forwardedCount = 0;

        // Forward each message to each target conversation
        for (const convId of targetConversationIds) {
            for (const message of validMessages) {
                if (!message) continue;

                await this.createMessage({
                    conversationId: convId,
                    senderId: userId,
                    content: message.content,
                    type: message.type,
                    documentUrl: message.documentUrl,
                    documentName: message.documentName,
                    documentMimeType: message.documentMimeType,
                    documentSize: message.documentSize
                });
                forwardedCount++;
            }
        }

        log.info(`User ${userId} forwarded ${forwardedCount} messages to ${targetConversationIds.length} conversations`);
        return forwardedCount;
    }

    /**
     * Generate signed URL for a specific document
     * Used when a client needs to refresh an expired URL
     */
    async getDocumentSignedUrl(messageId: string, userId: string): Promise<string | null> {
        const message = await messageRepository.findById(messageId);

        if (!message) {
            return null;
        }

        // Verify user is participant in the conversation
        const isParticipant = await conversationService.isParticipant(
            message.conversationId.toString(),
            userId
        );
        if (!isParticipant) {
            return null;
        }

        // Check if message has a document and it's stored in private bucket
        if (!message.documentUrl) {
            return null;
        }

        // If it's a gs:// path, generate signed URL
        if (message.documentUrl.startsWith('gs://')) {
            try {
                return await settingsServiceClient.getSignedUrl(message.documentUrl, 3600);
            } catch (error) {
                log.error(`Error generating signed URL for message ${messageId}:`, error);
                return null;
            }
        }

        // Return existing URL if it's not a private GCS path
        return message.documentUrl;
    }

    /**
     * Attach signed URLs to messages with private documents
     * Batch operation for efficiency
     */
    private async attachSignedUrlsToMessages(messages: MessageWithSender[]): Promise<void> {
        // Find messages with documents stored in private bucket (gs:// paths)
        const messagesWithPrivateDocs = messages.filter(
            m => m.type === MessageType.DOCUMENT && m.documentUrl && m.documentUrl.startsWith('gs://')
        );

        if (messagesWithPrivateDocs.length === 0) {
            return;
        }

        try {
            // Collect all GCS paths
            const gcsPaths = messagesWithPrivateDocs.map(m => m.documentUrl!);

            // Batch generate signed URLs
            const signedUrls = await settingsServiceClient.getSignedUrls(gcsPaths, 3600); // 1 hour

            // Attach signed URLs to messages
            for (const message of messagesWithPrivateDocs) {
                const signedUrl = signedUrls.get(message.documentUrl!);
                if (signedUrl) {
                    message.documentSignedUrl = signedUrl;
                }
            }

            log.debug(`Generated ${signedUrls.size} signed URLs for ${messagesWithPrivateDocs.length} document messages`);
        } catch (error) {
            log.error('Error generating signed URLs for document messages:', error);
            // Continue without signed URLs - clients will need to request individually
        }
    }
}

export const messageService = new MessageService();
