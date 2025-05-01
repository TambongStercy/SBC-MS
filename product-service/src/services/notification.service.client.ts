import axios from 'axios';
import config from '../config'; // Assuming config holds the notification service URL
import logger from '../utils/logger';
// import { AppError } from '../utils/errors';

const log = logger.getLogger('NotificationServiceClient');

// Define expected input structure for the notification service internal endpoint
interface CreateNotificationInput {
    userId: string; // The ID of the user to notify
    type: string; // e.g., 'FLASH_SALE_START', 'GENERAL_ALERT'
    channel: string; // e.g., 'PUSH', 'EMAIL', 'IN_APP' (if IN_APP is just saving to DB)
    recipient: string; // User's email or phone (depending on channel)
    data: {
        subject?: string; // For email
        body: string; // Main message content
        relatedData?: Record<string, any>; // e.g., { productId: '...', flashSaleId: '...' }
    };
}

class NotificationServiceClient {
    private baseUrl: string;
    private serviceSecret: string;

    constructor() {
        this.baseUrl = config.services.notificationService; // e.g., http://localhost:3002/api
        this.serviceSecret = config.services.serviceSecret; // Shared secret
        if (!this.baseUrl || !this.serviceSecret) {
            log.error('Notification Service URL or Service Secret is not configured!');
            throw new Error('Notification service configuration missing.');
        }
    }

    /**
     * Sends a request to create a notification via the Notification Service.
     * This is intended for service-to-service communication.
     */
    async sendNotification(input: CreateNotificationInput): Promise<boolean> {
        const url = `${this.baseUrl}/internal/create`;
        log.info(`Calling Notification Service: POST ${url} for user ${input.userId}, type ${input.type}`);
        try {
            const response = await axios.post(
                url,
                input,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.serviceSecret}`, // Service-to-service auth
                        'X-Service-Name': 'product-service'
                    },
                    timeout: 3000 // Shorter timeout for notification trigger
                }
            );

            if (response.status === 201) {
                log.info(`Notification creation request sent successfully for user ${input.userId}.`);
                return true;
            } else {
                log.warn(`Notification Service returned non-success status ${response.status} for createNotification`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error calling Notification Service createNotification: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error(`Notification Service Response Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            }
            // Don't re-throw, just return false to indicate notification sending failed
            return false;
        }
    }
}

export const notificationServiceClient = new NotificationServiceClient(); 