import { Schema, Document, model, Types } from 'mongoose';

// Define notification types
export enum NotificationType {
    OTP = 'otp',
    TRANSACTION = 'transaction',
    SYSTEM = 'system',
    MARKETING = 'marketing',
    REFERRAL = 'referral',
    ACCOUNT = 'account',
}

// Define delivery channels
export enum DeliveryChannel {
    EMAIL = 'email',
    SMS = 'sms',
    WHATSAPP = 'whatsapp',
    PUSH = 'push',
}

// Define notification status
export enum NotificationStatus {
    PENDING = 'pending',
    SENT = 'sent',
    DELIVERED = 'delivered',
    FAILED = 'failed',
}

// Interface for notification data subdocument
interface INotificationData {
    templateId?: string;
    variables?: Record<string, any>;
    subject?: string;
    body: string;
}

// Interface for notification document
export interface INotification extends Document {
    userId: Types.ObjectId;
    type: NotificationType;
    channel: DeliveryChannel;
    recipient: string; // email or phone number
    status: NotificationStatus;
    data: INotificationData;
    errorDetails?: string;
    sentAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    retryCount: number;
    createdAt: Date;
    updatedAt: Date;
}

// Create notification data schema
const NotificationDataSchema = new Schema({
    templateId: { type: String },
    variables: { type: Schema.Types.Mixed },
    subject: { type: String },
    body: { type: String, required: true },
}, { _id: false });

// Create notification schema
const NotificationSchema = new Schema<INotification>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(NotificationType),
            required: true,
            index: true,
        },
        channel: {
            type: String,
            enum: Object.values(DeliveryChannel),
            required: true,
            index: true,
        },
        recipient: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(NotificationStatus),
            default: NotificationStatus.PENDING,
            index: true,
        },
        data: {
            type: NotificationDataSchema,
            required: true,
        },
        errorDetails: {
            type: String,
        },
        sentAt: {
            type: Date,
        },
        deliveredAt: {
            type: Date,
        },
        failedAt: {
            type: Date,
        },
        retryCount: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

// Create indexes for common queries
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ status: 1, createdAt: 1 });

// Create and export the model
const NotificationModel = model<INotification>('Notification', NotificationSchema);

export default NotificationModel; 