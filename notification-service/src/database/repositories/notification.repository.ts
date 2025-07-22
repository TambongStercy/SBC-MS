import NotificationModel, {
    INotification, NotificationStatus, NotificationType,
    DeliveryChannel
} from '../models/notification.model';
import { Types } from 'mongoose';

import logger from '../../utils/logger';

const log = logger.getLogger('NotificationRepository');

// Interface matching the input for the service's createNotification method
interface CreateNotificationInput {
    userId: string | Types.ObjectId; // Expecting ObjectId from service
    type: NotificationType;
    channel: DeliveryChannel;
    recipient: string;
    status: NotificationStatus;
    data: {
        templateId?: string;
        variables?: Record<string, any>;
        subject?: string;
        body: string;
    };
}

// Interface for update operations
interface UpdateNotificationInput {
    status?: NotificationStatus;
    sentAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    errorDetails?: string;
    // WhatsApp Cloud API specific fields
    whatsappStatus?: string;
    whatsappDeliveredAt?: Date;
    whatsappReadAt?: Date;
    whatsappError?: {
        code: number;
        title: string;
        message: string;
    };
}

export class NotificationRepository {

    async create(input: CreateNotificationInput): Promise<INotification> {
        try {
            const notification = await NotificationModel.create(input);
            return notification;
        } catch (error: any) {
            log.error(`Error creating notification in DB: ${error.message}`, { input });
            throw error;
        }
    }

    async findById(id: string | Types.ObjectId): Promise<INotification | null> {
        return NotificationModel.findById(id).lean(); // Use lean for performance if not modifying
    }

    async findByUserId(userId: string | Types.ObjectId, limit: number, skip: number): Promise<INotification[]> {
        return NotificationModel.find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
    }

    async getNotificationStats(userId: string | Types.ObjectId): Promise<{ unreadCount: number, totalCount: number }> {
        // This is a placeholder - real implementation depends on how 'read' status is managed
        // Assuming 'read' status isn't tracked directly, return total count only for now.
        const totalCount = await NotificationModel.countDocuments({ userId: new Types.ObjectId(userId) });
        return {
            unreadCount: totalCount, // Placeholder: Assume all are unread until read status implemented
            totalCount
        };
    }

    async findPendingNotifications(limit: number): Promise<INotification[]> {
        return NotificationModel.find({ status: NotificationStatus.PENDING })
            .sort({ createdAt: 1 }) // Process oldest first
            .limit(limit)
            .lean();
    }

    async update(id: string | Types.ObjectId, updateData: UpdateNotificationInput): Promise<INotification | null> {
        try {
            const notification = await NotificationModel.findByIdAndUpdate(
                id,
                { $set: updateData },
                { new: true } // Return the updated document
            );
            return notification;
        } catch (error: any) {
            log.error(`Error updating notification ${id}: ${error.message}`, { updateData });
            throw error;
        }
    }

    async markAsSent(id: string | Types.ObjectId): Promise<boolean> {
        const result = await NotificationModel.updateOne(
            { _id: id, status: NotificationStatus.PENDING }, // Only update if pending
            { $set: { status: NotificationStatus.SENT, sentAt: new Date() } }
        );
        return result.modifiedCount > 0;
    }

    async markAsFailed(id: string | Types.ObjectId, errorDetails: string): Promise<boolean> {
        const result = await NotificationModel.updateOne(
            { _id: id, status: NotificationStatus.PENDING }, // Only update if pending
            { $set: { status: NotificationStatus.FAILED, failedAt: new Date(), errorDetails: errorDetails } }
        );
        return result.modifiedCount > 0;
    }

    // WhatsApp Cloud API specific methods

    /**
     * Find notification by WhatsApp message ID
     */
    async findByWhatsAppMessageId(messageId: string): Promise<INotification | null> {
        try {
            return await NotificationModel.findOne({ whatsappMessageId: messageId }).lean();
        } catch (error: any) {
            log.error(`Error finding notification by WhatsApp message ID ${messageId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update notification with WhatsApp message ID after sending
     */
    async updateWithWhatsAppMessageId(id: string | Types.ObjectId, messageId: string): Promise<boolean> {
        try {
            const result = await NotificationModel.updateOne(
                { _id: id },
                { $set: { whatsappMessageId: messageId } }
            );
            return result.modifiedCount > 0;
        } catch (error: any) {
            log.error(`Error updating notification ${id} with WhatsApp message ID: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update notification with WhatsApp webhook status
     */
    async updateWhatsAppStatus(
        messageId: string, 
        updateData: {
            whatsappStatus?: string;
            whatsappDeliveredAt?: Date;
            whatsappReadAt?: Date;
            whatsappError?: { code: number; title: string; message: string; };
            status?: NotificationStatus;
            deliveredAt?: Date;
            sentAt?: Date;
            failedAt?: Date;
            errorDetails?: string;
        }
    ): Promise<INotification | null> {
        try {
            const notification = await NotificationModel.findOneAndUpdate(
                { whatsappMessageId: messageId },
                { $set: updateData },
                { new: true }
            );
            
            if (!notification) {
                log.warn(`No notification found with WhatsApp message ID: ${messageId}`);
            }
            
            return notification;
        } catch (error: any) {
            log.error(`Error updating WhatsApp status for message ${messageId}: ${error.message}`, { updateData });
            throw error;
        }
    }

    /**
     * Mark notification as sent with WhatsApp message ID
     */
    async markAsSentWithMessageId(id: string | Types.ObjectId, messageId: string): Promise<boolean> {
        try {
            const result = await NotificationModel.updateOne(
                { _id: id, status: NotificationStatus.PENDING },
                { 
                    $set: { 
                        status: NotificationStatus.SENT, 
                        sentAt: new Date(),
                        whatsappMessageId: messageId,
                        whatsappStatus: 'sent'
                    } 
                }
            );
            return result.modifiedCount > 0;
        } catch (error: any) {
            log.error(`Error marking notification ${id} as sent with message ID: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get WhatsApp delivery statistics
     */
    async getWhatsAppDeliveryStats(userId?: string | Types.ObjectId): Promise<{
        totalSent: number;
        delivered: number;
        read: number;
        failed: number;
        pending: number;
    }> {
        try {
            const matchFilter: any = { channel: DeliveryChannel.WHATSAPP };
            if (userId) {
                matchFilter.userId = new Types.ObjectId(userId);
            }

            const stats = await NotificationModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: null,
                        totalSent: { $sum: { $cond: [{ $ne: ['$whatsappMessageId', null] }, 1, 0] } },
                        delivered: { $sum: { $cond: [{ $ne: ['$whatsappDeliveredAt', null] }, 1, 0] } },
                        read: { $sum: { $cond: [{ $ne: ['$whatsappReadAt', null] }, 1, 0] } },
                        failed: { $sum: { $cond: [{ $eq: ['$status', NotificationStatus.FAILED] }, 1, 0] } },
                        pending: { $sum: { $cond: [{ $eq: ['$status', NotificationStatus.PENDING] }, 1, 0] } }
                    }
                }
            ]);

            return stats[0] || { totalSent: 0, delivered: 0, read: 0, failed: 0, pending: 0 };
        } catch (error: any) {
            log.error(`Error getting WhatsApp delivery stats: ${error.message}`);
            throw error;
        }
    }
}

// Export singleton instance
export const notificationRepository = new NotificationRepository(); 