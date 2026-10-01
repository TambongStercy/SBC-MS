import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('NotificationServiceClient');

const client = axios.create({
    baseURL: config.services.notificationServiceUrl,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'chat-service',
    },
});

export type ChatPush = {
    userId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
    icon?: string;
};

/** A push to the user's phones. Best-effort: never throws. */
export const sendChatPush = async (p: ChatPush): Promise<void> => {
    try {
        await client.post('/notifications/push/internal/send', { ...p, category: 'chat', renotify: true });
    } catch (err) {
        log.warn(`Chat push to ${p.userId} failed: ${(err as Error).message}`);
    }
};
