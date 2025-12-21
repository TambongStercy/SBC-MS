import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('PresenceService');

class PresenceService {
    private redis: Redis;
    private readonly ONLINE_KEY_PREFIX = 'presence:online:';
    private readonly SOCKET_KEY_PREFIX = 'presence:socket:';
    private readonly TYPING_KEY_PREFIX = 'presence:typing:';
    private readonly ONLINE_TTL = 300; // 5 minutes
    private readonly TYPING_TTL = 10; // 10 seconds

    constructor() {
        this.redis = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password || undefined,
            db: config.redis.db
        });

        this.redis.on('connect', () => {
            log.info('Redis connected for presence service');
        });

        this.redis.on('error', (err) => {
            log.error('Redis error:', err);
        });
    }

    /**
     * Set user as online
     */
    async setOnline(userId: string, socketId: string): Promise<void> {
        const multi = this.redis.multi();

        // Set user as online with TTL
        multi.set(`${this.ONLINE_KEY_PREFIX}${userId}`, socketId, 'EX', this.ONLINE_TTL);

        // Map socket to user
        multi.set(`${this.SOCKET_KEY_PREFIX}${socketId}`, userId, 'EX', this.ONLINE_TTL);

        await multi.exec();
        log.debug(`User ${userId} is now online with socket ${socketId}`);
    }

    /**
     * Set user as offline
     */
    async setOffline(userId: string): Promise<void> {
        const socketId = await this.redis.get(`${this.ONLINE_KEY_PREFIX}${userId}`);

        const multi = this.redis.multi();

        // Remove online status
        multi.del(`${this.ONLINE_KEY_PREFIX}${userId}`);

        // Remove socket mapping
        if (socketId) {
            multi.del(`${this.SOCKET_KEY_PREFIX}${socketId}`);
        }

        // Remove any typing indicators
        const typingKeys = await this.redis.keys(`${this.TYPING_KEY_PREFIX}*:${userId}`);
        for (const key of typingKeys) {
            multi.del(key);
        }

        await multi.exec();
        log.debug(`User ${userId} is now offline`);
    }

    /**
     * Check if user is online
     */
    async isOnline(userId: string): Promise<boolean> {
        const result = await this.redis.exists(`${this.ONLINE_KEY_PREFIX}${userId}`);
        return result === 1;
    }

    /**
     * Get online status for multiple users
     */
    async getOnlineStatuses(userIds: string[]): Promise<Map<string, boolean>> {
        const result = new Map<string, boolean>();

        if (userIds.length === 0) {
            return result;
        }

        const keys = userIds.map(id => `${this.ONLINE_KEY_PREFIX}${id}`);
        const values = await this.redis.mget(...keys);

        userIds.forEach((userId, index) => {
            result.set(userId, values[index] !== null);
        });

        return result;
    }

    /**
     * Get user ID from socket ID
     */
    async getUserIdFromSocket(socketId: string): Promise<string | null> {
        return this.redis.get(`${this.SOCKET_KEY_PREFIX}${socketId}`);
    }

    /**
     * Get socket ID for user
     */
    async getSocketIdForUser(userId: string): Promise<string | null> {
        return this.redis.get(`${this.ONLINE_KEY_PREFIX}${userId}`);
    }

    /**
     * Refresh online status (heartbeat)
     */
    async refreshOnline(userId: string): Promise<void> {
        const socketId = await this.redis.get(`${this.ONLINE_KEY_PREFIX}${userId}`);
        if (socketId) {
            await this.redis.expire(`${this.ONLINE_KEY_PREFIX}${userId}`, this.ONLINE_TTL);
            await this.redis.expire(`${this.SOCKET_KEY_PREFIX}${socketId}`, this.ONLINE_TTL);
        }
    }

    /**
     * Set typing indicator
     */
    async setTyping(conversationId: string, userId: string): Promise<void> {
        await this.redis.set(
            `${this.TYPING_KEY_PREFIX}${conversationId}:${userId}`,
            '1',
            'EX',
            this.TYPING_TTL
        );
    }

    /**
     * Clear typing indicator
     */
    async clearTyping(conversationId: string, userId: string): Promise<void> {
        await this.redis.del(`${this.TYPING_KEY_PREFIX}${conversationId}:${userId}`);
    }

    /**
     * Get users typing in a conversation
     */
    async getTypingUsers(conversationId: string): Promise<string[]> {
        const pattern = `${this.TYPING_KEY_PREFIX}${conversationId}:*`;
        const keys = await this.redis.keys(pattern);

        return keys.map(key => {
            const parts = key.split(':');
            return parts[parts.length - 1];
        });
    }

    /**
     * Get all online users (for debugging/admin)
     */
    async getAllOnlineUsers(): Promise<string[]> {
        const keys = await this.redis.keys(`${this.ONLINE_KEY_PREFIX}*`);
        return keys.map(key => key.replace(this.ONLINE_KEY_PREFIX, ''));
    }

    /**
     * Close Redis connection
     */
    async close(): Promise<void> {
        await this.redis.quit();
        log.info('Presence service Redis connection closed');
    }
}

export const presenceService = new PresenceService();
