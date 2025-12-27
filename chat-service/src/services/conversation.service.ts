import { Types } from 'mongoose';
import { conversationRepository } from '../database/repositories/conversation.repository';
import { messageRepository } from '../database/repositories/message.repository';
import { IConversation, ConversationType, ConversationAcceptanceStatus } from '../database/models/conversation.model';
import { userServiceClient, UserDetails } from './clients/user.service.client';
import { presenceService } from './presence.service';
import logger from '../utils/logger';

const log = logger.getLogger('ConversationService');

export interface MessagingStatus {
    canSend: boolean;
    reason?: 'accepted' | 'pending_limit_not_reached' | 'pending_limit_reached' | 'blocked' | 'reported';
    messagesRemaining?: number; // Only for pending conversations
}

export interface ConversationWithDetails {
    _id: string;
    type: ConversationType;
    participants: Array<{
        _id: string;
        name: string;
        avatar?: string;
        isOnline: boolean;
    }>;
    lastMessage?: {
        content: string;
        senderId: string;
        createdAt: Date;
    };
    lastMessageAt?: Date;
    unreadCount: number;
    statusId?: string;
    acceptanceStatus?: ConversationAcceptanceStatus;
    messagingStatus?: MessagingStatus;
    isInitiator?: boolean; // Whether the current user started this conversation
}

class ConversationService {
    /**
     * Get or create a direct conversation between two users
     */
    async getOrCreateDirectConversation(
        userId1: string,
        userId2: string
    ): Promise<IConversation> {
        // Check if conversation already exists
        let conversation = await conversationRepository.findDirectConversation(userId1, userId2);

        if (!conversation) {
            // Create new conversation with pending status
            // userId1 is the initiator (the one who started the conversation)
            conversation = await conversationRepository.create({
                participants: [new Types.ObjectId(userId1), new Types.ObjectId(userId2)],
                type: ConversationType.DIRECT,
                acceptanceStatus: ConversationAcceptanceStatus.PENDING,
                initiatorId: new Types.ObjectId(userId1),
                unreadCounts: new Map(),
                messageCounts: new Map()
            });
            log.info(`Created new direct conversation between ${userId1} and ${userId2}`);
        }

        return conversation;
    }

    /**
     * Get or create a conversation for status reply
     */
    async getOrCreateStatusReplyConversation(
        statusId: string,
        replyerId: string,
        authorId: string
    ): Promise<IConversation> {
        // Check if conversation already exists
        let conversation = await conversationRepository.findStatusReplyConversation(
            statusId,
            replyerId,
            authorId
        );

        if (!conversation) {
            // Create new conversation with pending status
            // replyerId is the initiator (the one who replied to the status)
            conversation = await conversationRepository.create({
                participants: [new Types.ObjectId(replyerId), new Types.ObjectId(authorId)],
                type: ConversationType.STATUS_REPLY,
                statusId: new Types.ObjectId(statusId),
                acceptanceStatus: ConversationAcceptanceStatus.PENDING,
                initiatorId: new Types.ObjectId(replyerId),
                unreadCounts: new Map(),
                messageCounts: new Map()
            });
            log.info(`Created status reply conversation for status ${statusId}`);
        }

        return conversation;
    }

    /**
     * Get user's conversations with full details
     */
    async getUserConversations(
        userId: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ conversations: ConversationWithDetails[]; total: number; totalPages: number }> {
        const { conversations, total } = await conversationRepository.getUserConversations(
            userId,
            page,
            limit
        );

        // Get all participant IDs
        const participantIds = new Set<string>();
        for (const conv of conversations) {
            for (const participantId of conv.participants) {
                participantIds.add(participantId.toString());
            }
        }

        // Fetch user details
        const userDetails = await userServiceClient.getMultipleUsers(Array.from(participantIds));

        // Get online statuses
        const onlineStatuses = await presenceService.getOnlineStatuses(Array.from(participantIds));

        // Build response with messaging status
        const conversationsWithDetails: ConversationWithDetails[] = await Promise.all(
            conversations.map(async conv => {
                const participants = conv.participants.map(participantId => {
                    const id = participantId.toString();
                    const user = userDetails.get(id);
                    return {
                        _id: id,
                        name: user?.name || 'Unknown User',
                        avatar: user?.avatar,
                        isOnline: onlineStatuses.get(id) || false
                    };
                });

                // Calculate messaging status
                const messagingStatus = await this.getMessagingStatus(conv, userId);
                const isInitiator = conv.initiatorId?.toString() === userId;

                return {
                    _id: conv._id.toString(),
                    type: conv.type,
                    participants,
                    lastMessage: conv.lastMessagePreview ? {
                        content: conv.lastMessagePreview,
                        senderId: conv.lastMessageSenderId?.toString() || '',
                        createdAt: conv.lastMessageAt || conv.updatedAt
                    } : undefined,
                    lastMessageAt: conv.lastMessageAt,
                    unreadCount: conv.unreadCounts.get(userId) || 0,
                    statusId: conv.statusId?.toString(),
                    acceptanceStatus: conv.acceptanceStatus,
                    messagingStatus,
                    isInitiator
                };
            })
        );

        return {
            conversations: conversationsWithDetails,
            total,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Get user's archived conversations
     */
    async getArchivedConversations(
        userId: string,
        page: number = 1,
        limit: number = 20
    ): Promise<{ conversations: ConversationWithDetails[]; total: number; totalPages: number }> {
        const { conversations, total } = await conversationRepository.getArchivedConversations(
            userId,
            page,
            limit
        );

        // Get all participant IDs
        const participantIds = new Set<string>();
        for (const conv of conversations) {
            for (const participantId of conv.participants) {
                participantIds.add(participantId.toString());
            }
        }

        // Fetch user details
        const userDetails = await userServiceClient.getMultipleUsers(Array.from(participantIds));

        // Get online statuses
        const onlineStatuses = await presenceService.getOnlineStatuses(Array.from(participantIds));

        // Build response with messaging status
        const conversationsWithDetails: ConversationWithDetails[] = await Promise.all(
            conversations.map(async conv => {
                const participants = conv.participants.map(participantId => {
                    const id = participantId.toString();
                    const user = userDetails.get(id);
                    return {
                        _id: id,
                        name: user?.name || 'Unknown User',
                        avatar: user?.avatar,
                        isOnline: onlineStatuses.get(id) || false
                    };
                });

                // Calculate messaging status
                const messagingStatus = await this.getMessagingStatus(conv, userId);
                const isInitiator = conv.initiatorId?.toString() === userId;

                return {
                    _id: conv._id.toString(),
                    type: conv.type,
                    participants,
                    lastMessage: conv.lastMessagePreview ? {
                        content: conv.lastMessagePreview,
                        senderId: conv.lastMessageSenderId?.toString() || '',
                        createdAt: conv.lastMessageAt || conv.updatedAt
                    } : undefined,
                    lastMessageAt: conv.lastMessageAt,
                    unreadCount: conv.unreadCounts.get(userId) || 0,
                    statusId: conv.statusId?.toString(),
                    acceptanceStatus: conv.acceptanceStatus,
                    messagingStatus,
                    isInitiator
                };
            })
        );

        return {
            conversations: conversationsWithDetails,
            total,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Get conversation by ID
     */
    async getConversationById(
        conversationId: string,
        userId: string
    ): Promise<ConversationWithDetails | null> {
        const conversation = await conversationRepository.findById(conversationId);

        if (!conversation) {
            return null;
        }

        // Verify user is participant
        const isParticipant = conversation.participants.some(
            p => p.toString() === userId
        );
        if (!isParticipant) {
            return null;
        }

        // Get participant details
        const participantIds = conversation.participants.map(p => p.toString());
        const userDetails = await userServiceClient.getMultipleUsers(participantIds);
        const onlineStatuses = await presenceService.getOnlineStatuses(participantIds);

        const participants = conversation.participants.map(participantId => {
            const id = participantId.toString();
            const user = userDetails.get(id);
            return {
                _id: id,
                name: user?.name || 'Unknown User',
                avatar: user?.avatar,
                isOnline: onlineStatuses.get(id) || false
            };
        });

        // Calculate messaging status
        const messagingStatus = await this.getMessagingStatus(conversation, userId);
        const isInitiator = conversation.initiatorId?.toString() === userId;

        return {
            _id: conversation._id.toString(),
            type: conversation.type,
            participants,
            lastMessage: conversation.lastMessagePreview ? {
                content: conversation.lastMessagePreview,
                senderId: conversation.lastMessageSenderId?.toString() || '',
                createdAt: conversation.lastMessageAt || conversation.updatedAt
            } : undefined,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: conversation.unreadCounts.get(userId) || 0,
            statusId: conversation.statusId?.toString(),
            acceptanceStatus: conversation.acceptanceStatus,
            messagingStatus,
            isInitiator
        };
    }

    /**
     * Check if user is participant in conversation
     */
    async isParticipant(conversationId: string, userId: string): Promise<boolean> {
        return conversationRepository.isParticipant(conversationId, userId);
    }

    /**
     * Update conversation after new message
     */
    async updateLastMessage(
        conversationId: string,
        messageId: Types.ObjectId,
        senderId: Types.ObjectId,
        preview: string,
        otherParticipantIds: string[]
    ): Promise<void> {
        await conversationRepository.updateLastMessage(conversationId, messageId, senderId, preview);

        // Increment unread count for other participants
        for (const participantId of otherParticipantIds) {
            await conversationRepository.incrementUnreadCount(conversationId, participantId);
        }
    }

    /**
     * Mark conversation as read
     */
    async markAsRead(conversationId: string, userId: string): Promise<number> {
        // Mark all messages as read
        const count = await messageRepository.markAllAsRead(conversationId, userId);

        // Reset unread count
        await conversationRepository.resetUnreadCount(conversationId, userId);

        return count;
    }

    /**
     * Delete conversation for user
     */
    async deleteForUser(conversationId: string, userId: string): Promise<void> {
        await conversationRepository.deleteForUser(conversationId, userId);
        log.info(`User ${userId} deleted conversation ${conversationId}`);
    }

    /**
     * Restore (undelete) conversation for user
     * Called when user sends a message in a deleted conversation
     */
    async restoreForUser(conversationId: string, userId: string): Promise<void> {
        await conversationRepository.restoreForUser(conversationId, userId);
        log.info(`User ${userId} restored conversation ${conversationId}`);
    }

    /**
     * Get participants of a conversation
     */
    async getParticipants(conversationId: string): Promise<string[]> {
        const participants = await conversationRepository.getParticipants(conversationId);
        return participants.map(p => p.toString());
    }

    /**
     * Check if user can send messages in an unaccepted conversation
     * Throws error if user has reached the 3-message limit
     */
    async checkMessageLimit(conversationId: string, userId: string): Promise<void> {
        log.debug(`[checkMessageLimit] Starting check for user ${userId} in conversation ${conversationId}`);

        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
            log.error(`[checkMessageLimit] Conversation ${conversationId} not found`);
            throw new Error('Conversation not found');
        }

        log.debug(`[checkMessageLimit] Conversation acceptanceStatus: ${conversation.acceptanceStatus}`);

        // If conversation is already accepted, no limit applies
        if (conversation.acceptanceStatus === 'accepted') {
            log.debug(`[checkMessageLimit] Conversation is accepted, no limit applies`);
            return;
        }

        // If conversation is reported or blocked, no messages allowed
        if (conversation.acceptanceStatus === 'reported' || conversation.acceptanceStatus === 'blocked') {
            log.warn(`[checkMessageLimit] Conversation is ${conversation.acceptanceStatus}, blocking message`);
            throw new Error('Cannot send messages in a reported or blocked conversation');
        }

        // Check if user is admin
        log.debug(`[checkMessageLimit] Checking if user ${userId} is admin...`);
        const isAdmin = await userServiceClient.isAdmin(userId);
        log.debug(`[checkMessageLimit] User ${userId} admin check result: ${isAdmin}`);

        if (isAdmin) {
            log.info(`[checkMessageLimit] User ${userId} is admin, exempting from limit`);
            return; // Admins are exempt from limit
        }

        // Check if users have a direct referral relationship
        const participants = conversation.participants.map(p => p.toString());
        const otherParticipants = participants.filter(p => p !== userId);

        log.debug(`[checkMessageLimit] Checking referral relationships with participants: ${otherParticipants.join(', ')}`);

        for (const otherUserId of otherParticipants) {
            const hasDirectReferral = await userServiceClient.checkDirectReferralRelationship(
                userId,
                otherUserId
            );
            log.debug(`[checkMessageLimit] Direct referral check between ${userId} and ${otherUserId}: ${hasDirectReferral}`);

            if (hasDirectReferral) {
                log.info(`[checkMessageLimit] Users have direct referral relationship, exempting from limit`);
                return; // Users with direct referral relationship are exempt
            }
        }

        // Check message count
        const messageCount = await conversationRepository.getMessageCount(conversationId, userId);
        log.debug(`[checkMessageLimit] Current message count for user ${userId}: ${messageCount}`);

        if (messageCount >= 3) {
            log.warn(`[checkMessageLimit] User ${userId} has reached limit (${messageCount}/3 messages)`);
            throw new Error('You have reached the maximum of 3 messages. The recipient must accept this conversation before you can send more messages.');
        }

        log.debug(`[checkMessageLimit] Check passed, user can send message (${messageCount}/3)`);
    }

    /**
     * Increment message count for a user in a conversation
     */
    async incrementMessageCount(conversationId: string, userId: string): Promise<void> {
        await conversationRepository.incrementMessageCount(conversationId, userId);
    }

    /**
     * Accept a conversation
     */
    async acceptConversation(conversationId: string, userId: string): Promise<void> {
        // Verify user is participant
        const isParticipant = await this.isParticipant(conversationId, userId);
        if (!isParticipant) {
            throw new Error('Not a participant in this conversation');
        }

        await conversationRepository.acceptConversation(conversationId);
        log.info(`User ${userId} accepted conversation ${conversationId}`);
    }

    /**
     * Report a conversation
     */
    async reportConversation(conversationId: string, userId: string): Promise<void> {
        // Verify user is participant
        const isParticipant = await this.isParticipant(conversationId, userId);
        if (!isParticipant) {
            throw new Error('Not a participant in this conversation');
        }

        await conversationRepository.reportConversation(conversationId, userId);
        log.info(`User ${userId} reported conversation ${conversationId}`);
    }

    /**
     * Get the messaging status for a conversation
     * This determines if a user can send messages and why
     */
    private async getMessagingStatus(conversation: IConversation, userId: string): Promise<MessagingStatus> {
        const conversationId = conversation._id.toString();

        // If conversation is accepted, user can always send
        if (conversation.acceptanceStatus === ConversationAcceptanceStatus.ACCEPTED) {
            return { canSend: true, reason: 'accepted' };
        }

        // If conversation is blocked or reported, user cannot send
        if (conversation.acceptanceStatus === ConversationAcceptanceStatus.BLOCKED) {
            return { canSend: false, reason: 'blocked' };
        }

        if (conversation.acceptanceStatus === ConversationAcceptanceStatus.REPORTED) {
            return { canSend: false, reason: 'reported' };
        }

        // For pending conversations, check if user is the initiator and their message count
        const isInitiator = conversation.initiatorId?.toString() === userId;

        // If user is NOT the initiator (they are the recipient), they can always send
        // because sending a message would accept the conversation
        if (!isInitiator) {
            return { canSend: true, reason: 'accepted' };
        }

        // For initiators in pending conversations, check message limit
        try {
            // Check if user is admin (admins are exempt)
            const isAdmin = await userServiceClient.isAdmin(userId);
            if (isAdmin) {
                return { canSend: true, reason: 'accepted' };
            }

            // Check for direct referral relationship
            const participants = conversation.participants.map(p => p.toString());
            const otherParticipants = participants.filter(p => p !== userId);

            for (const otherUserId of otherParticipants) {
                const hasDirectReferral = await userServiceClient.checkDirectReferralRelationship(
                    userId,
                    otherUserId
                );
                if (hasDirectReferral) {
                    return { canSend: true, reason: 'accepted' };
                }
            }

            // Check message count
            const messageCount = await conversationRepository.getMessageCount(conversationId, userId);
            const messagesRemaining = Math.max(0, 3 - messageCount);

            if (messageCount >= 3) {
                return {
                    canSend: false,
                    reason: 'pending_limit_reached',
                    messagesRemaining: 0
                };
            }

            return {
                canSend: true,
                reason: 'pending_limit_not_reached',
                messagesRemaining
            };
        } catch (error: any) {
            log.error(`Error calculating messaging status for conversation ${conversationId}:`, error);
            // In case of error, default to allowing messages
            return { canSend: true, reason: 'pending_limit_not_reached', messagesRemaining: 3 };
        }
    }
}

export const conversationService = new ConversationService();
