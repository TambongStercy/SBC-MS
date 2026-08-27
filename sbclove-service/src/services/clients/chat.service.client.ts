import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('ChatServiceClient');

class ChatServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.chatService, // includes /api
            timeout: 8000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'sbclove-service'
            }
        });
        log.info('Chat service client initialized');
    }

    /** Get-or-create the LOVE conversation for a contact-unlocked match. */
    async getOrCreateLoveConversation(userId1: string, userId2: string, matchId: string): Promise<string> {
        const response = await this.apiClient.post('/chat/internal/love-conversation', {
            userId1, userId2, matchId
        });
        const data = response.data?.data ?? response.data;
        if (!data?.conversationId) {
            throw new Error('chat-service did not return a conversationId');
        }
        return data.conversationId as string;
    }
}

export const chatServiceClient = new ChatServiceClient();
