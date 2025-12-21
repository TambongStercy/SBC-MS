import { Types, FilterQuery } from 'mongoose';
import MessageModel, { IMessage, MessageType, MessageStatus } from '../models/message.model';
import logger from '../../utils/logger';

const log = logger.getLogger('MessageRepository');

export class MessageRepository {
    /**
     * Create a new message
     */
    async create(data: Partial<IMessage>): Promise<IMessage> {
        const message = new MessageModel(data);
        return message.save();
    }

    /**
     * Find message by ID
     */
    async findById(messageId: string | Types.ObjectId): Promise<IMessage | null> {
        return MessageModel.findById(messageId).exec();
    }

    /**
     * Get messages in a conversation with pagination
     */
    async getConversationMessages(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId,
        page: number = 1,
        limit: number = 50
    ): Promise<{ messages: IMessage[]; total: number }> {
        const skip = (page - 1) * limit;

        const query: FilterQuery<IMessage> = {
            conversationId,
            deleted: false,
            deletedFor: { $ne: userId }
        };

        const [messages, total] = await Promise.all([
            MessageModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            MessageModel.countDocuments(query).exec()
        ]);

        // Return in chronological order for display
        return { messages: messages.reverse(), total };
    }

    /**
     * Get unread messages count for a user in a conversation
     */
    async getUnreadCount(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<number> {
        return MessageModel.countDocuments({
            conversationId,
            senderId: { $ne: userId },
            readBy: { $ne: userId },
            deleted: false
        }).exec();
    }

    /**
     * Mark messages as read
     */
    async markAsRead(
        messageIds: (string | Types.ObjectId)[],
        userId: string | Types.ObjectId
    ): Promise<void> {
        await MessageModel.updateMany(
            {
                _id: { $in: messageIds },
                readBy: { $ne: userId }
            },
            {
                $addToSet: { readBy: userId },
                $set: { status: MessageStatus.READ }
            }
        ).exec();
    }

    /**
     * Mark all messages in conversation as read for a user
     */
    async markAllAsRead(
        conversationId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<number> {
        const result = await MessageModel.updateMany(
            {
                conversationId,
                senderId: { $ne: userId },
                readBy: { $ne: userId },
                deleted: false
            },
            {
                $addToSet: { readBy: userId },
                $set: { status: MessageStatus.READ }
            }
        ).exec();

        return result.modifiedCount;
    }

    /**
     * Mark messages as delivered
     */
    async markAsDelivered(
        messageIds: (string | Types.ObjectId)[],
        userId: string | Types.ObjectId
    ): Promise<void> {
        await MessageModel.updateMany(
            {
                _id: { $in: messageIds },
                deliveredTo: { $ne: userId },
                status: MessageStatus.SENT
            },
            {
                $addToSet: { deliveredTo: userId },
                $set: { status: MessageStatus.DELIVERED }
            }
        ).exec();
    }

    /**
     * Soft delete a message
     */
    async softDelete(
        messageId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<IMessage | null> {
        return MessageModel.findOneAndUpdate(
            {
                _id: messageId,
                senderId: userId // Only sender can delete
            },
            {
                deleted: true,
                deletedAt: new Date()
            },
            { new: true }
        ).exec();
    }

    /**
     * Delete message for specific user (hide from their view)
     */
    async deleteForUser(
        messageId: string | Types.ObjectId,
        userId: string | Types.ObjectId
    ): Promise<void> {
        await MessageModel.findByIdAndUpdate(
            messageId,
            { $addToSet: { deletedFor: userId } }
        ).exec();
    }

    /**
     * Get latest message in conversation
     */
    async getLatestMessage(conversationId: string | Types.ObjectId): Promise<IMessage | null> {
        return MessageModel.findOne({
            conversationId,
            deleted: false
        })
            .sort({ createdAt: -1 })
            .exec();
    }

    /**
     * Create ad message
     */
    async createAdMessage(
        conversationId: string | Types.ObjectId,
        adData: {
            adId: Types.ObjectId;
            adImageUrl: string;
            adRedirectUrl: string;
            adCta: string;
            content: string;
        }
    ): Promise<IMessage> {
        const message = new MessageModel({
            conversationId,
            senderId: new Types.ObjectId(), // System sender
            type: MessageType.AD,
            content: adData.content,
            adId: adData.adId,
            adImageUrl: adData.adImageUrl,
            adRedirectUrl: adData.adRedirectUrl,
            adCta: adData.adCta,
            status: MessageStatus.DELIVERED
        });
        return message.save();
    }
}

export const messageRepository = new MessageRepository();
