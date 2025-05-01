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
    failedAt?: Date;
    errorDetails?: string;
    // Add other updatable fields if needed
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

    // Add other necessary methods (e.g., findById, markAsRead, etc.)
}

// Export singleton instance
export const notificationRepository = new NotificationRepository(); 