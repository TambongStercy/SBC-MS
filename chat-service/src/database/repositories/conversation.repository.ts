import { Types, FilterQuery } from 'mongoose';
import ConversationModel, { IConversation, ConversationType } from '../models/conversation.model';
import logger from '../../utils/logger';

const log = logger.getLogger('ConversationRepository');

export interface ConversationWithParticipants extends IConversation {
    participantDetails?: Array<{
        _id: Types.ObjectId;
        name: string;
        avatar?: string;
    }>;
}

export class ConversationRepository {
    /**
     * Create a new conversation
     */
    async create(data: Partial<IConversation>): Promise<IConversation> {
        const conversation = new ConversationModel(data);
        return conversation.save();
    }

    /**
     * Find conversation by ID
     */
    async findById(conversationId: string | Types.ObjectId): Promise<IConversation | null> {
        return ConversationModel.findById(conversationId).exec();
    }

    /**
     * Find direct conversation between two users
     */
    async findDirectConversation(
        userId1: string | Types.ObjectId,
        userId2: string | Types.ObjectId
    ): Promise<IConversation | null> {
        return ConversationModel.findOne({
            type: ConversationType.DIRECT,
            participants: { $all: [userId1, userId2], $size: 2 }
        }).exec();
    }

    /**
     * Find conversation by status reply
     */
    async findStatusReplyConversation(
        statusId: string | Types.ObjectId,
        replyerId: string | Types.ObjectId,
        authorId: string | Types.ObjectId
    ): Promise<IConversation | null> {
        return ConversationModel.findOne({
            type: ConversationType.STATUS_REPLY,
            statusId: statusId,
            participants: { $all: [replyerId, authorId] }
        }).exec();
    }

    /**
     * Get user's conversations with pagination
     */
    async getUserConversations(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<{ conversations: IConversation[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IConversation> = {
            participants: userId,
            deletedFor: { $ne: userId }
        };

        const [conversations, total] = await Promise.all([
            ConversationModel.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            ConversationModel.countDocuments(query).exec()
        ]);

        return { conversations, total };
    }

    /**
     * Get user's archived conversations
     */
    async getArchivedConversations(
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 20
    ): Promise<{ conversations: IConversation[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IConversation> = {
            participants: userId,
            deletedFor: userId
        };

        const [conversations, total] = await Promise.all([
            ConversationModel.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            ConversationModel.countDocuments(query).exec()
        ]);

        return { conversations, total };
    }

    /**
     * Check if user is participant in conversation
     */
    async isParticipant(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<boolean> {
        const conversation = await ConversationModel.findOne({
            _id: conversationId,
            participants: userId
        }).exec();
        return !!conversation;
    }

    /**
     * Update conversation with last message info
     */
    async updateLastMessage(
        conversationId: string | Types.ObjectId,
        messageId: Types.ObjectId,
        senderId: Types.ObjectId,
        preview: string
    ): Promise<IConversation | null> {
        return ConversationModel.findByIdAndUpdate(
            conversationId,
            {
                lastMessage: messageId,
                lastMessageAt: new Date(),
                lastMessagePreview: preview.substring(0, 100),
                lastMessageSenderId: senderId
            },
            { new: true }
        ).exec();
    }

    /**
     * Increment unread count for a user
     */
    async incrementUnreadCount(
        conversationId: string | Types.ObjectId,
        userId: string
    ): Promise<void> {
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            { $inc: { [`unreadCounts.${userId}`]: 1 } }
        ).exec();
    }

    /**
     * Reset unread count for a user
     */
    async resetUnreadCount(
        conversationId: string | Types.ObjectId,
        userId: string
    ): Promise<void> {
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            { $set: { [`unreadCounts.${userId}`]: 0 } }
        ).exec();
    }

    /**
     * Soft delete conversation for a user
     */
    async deleteForUser(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<void> {
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            { $addToSet: { deletedFor: userId } }
        ).exec();
    }

    /**
     * Restore (undelete) a conversation for a user
     * Called when user sends a new message in a deleted conversation
     */
    async restoreForUser(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<void> {
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            { $pull: { deletedFor: userId } }
        ).exec();
    }

    /**
     * Get conversation participants
     */
    async getParticipants(conversationId: string | Types.ObjectId): Promise<Types.ObjectId[]> {
        const conversation = await ConversationModel.findById(conversationId)
            .select('participants')
            .exec();
        return conversation?.participants || [];
    }

    /**
     * Increment message count for a user in a conversation
     */
    async incrementMessageCount(
        conversationId: string | Types.ObjectId,
        userId: string
    ): Promise<void> {
        await ConversationModel.findByIdAndUpdate(
            conversationId,
            { $inc: { [`messageCounts.${userId}`]: 1 } }
        ).exec();
    }

    /**
     * Get message count for a user in a conversation
     */
    async getMessageCount(
        conversationId: string | Types.ObjectId,
        userId: string
    ): Promise<number> {
        const conversation = await ConversationModel.findById(conversationId)
            .select('messageCounts')
            .exec();
        return conversation?.messageCounts.get(userId) || 0;
    }

    /**
     * Accept a conversation
     */
    async acceptConversation(
        conversationId: string | Types.ObjectId
    ): Promise<IConversation | null> {
        return ConversationModel.findByIdAndUpdate(
            conversationId,
            {
                acceptanceStatus: 'accepted',
                acceptedAt: new Date()
            },
            { new: true }
        ).exec();
    }

    /**
     * Report a conversation
     */
    async reportConversation(
        conversationId: string | Types.ObjectId,
        reporterId: string | Types.ObjectId
    ): Promise<IConversation | null> {
        return ConversationModel.findByIdAndUpdate(
            conversationId,
            {
                acceptanceStatus: 'reported',
                reportedAt: new Date(),
                reportedBy: reporterId
            },
            { new: true }
        ).exec();
    }
}

export const conversationRepository = new ConversationRepository();
