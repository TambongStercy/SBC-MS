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
export interface INotificationData {
    templateId?: string;
    variables?: Record<string, any>;
    subject?: string;
    body: string;
    plainText?: string;
    whatsappCode?: string;
    language?: string; // Language preference for templates (e.g., 'en_US', 'fr')
    lang?: string; // Alternative language field
    attachmentContent?: string;
    attachmentFileName?: string;
    attachmentContentType?: string;
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
    // WhatsApp Cloud API specific fields
    whatsappMessageId?: string;
    whatsappStatus?: string;
    whatsappDeliveredAt?: Date;
    whatsappReadAt?: Date;
    whatsappError?: {
        code: number;
        title: string;
        message: string;
    };
}

// Create notification data schema
const NotificationDataSchema = new Schema({
    templateId: { type: String },
    variables: { type: Schema.Types.Mixed },
    subject: { type: String },
    body: { type: String, required: true },
    plainText: { type: String },
    whatsappCode: { type: String },
    language: { type: String }, // Added language field
    lang: { type: String }, // Added lang field
    attachmentContent: { type: String },
    attachmentFileName: { type: String },
    attachmentContentType: { type: String },
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
        // WhatsApp Cloud API specific fields
        whatsappMessageId: {
            type: String,
            index: true,
        },
        whatsappStatus: {
            type: String,
        },
        whatsappDeliveredAt: {
            type: Date,
        },
        whatsappReadAt: {
            type: Date,
        },
        whatsappError: {
            code: { type: Number },
            title: { type: String },
            message: { type: String },
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