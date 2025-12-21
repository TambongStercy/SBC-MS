import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../socket.server';
import { presenceService } from '../../services/presence.service';
import logger from '../../utils/logger';

const log = logger.getLogger('PresenceHandler');

export function presenceHandler(io: Server, socket: AuthenticatedSocket) {
    // Get online status for multiple users
    socket.on('presence:get', async (userIds: string[]) => {
        try {
            if (!userIds || !Array.isArray(userIds)) {
                socket.emit('presence:error', { error: 'userIds array is required' });
                return;
            }

            const statuses = await presenceService.getOnlineStatuses(userIds);
            const result: Record<string, boolean> = {};

            statuses.forEach((isOnline, oderId) => {
                result[oderId] = isOnline;
            });

            socket.emit('presence:status', result);
        } catch (error: any) {
            log.error('Error getting presence status:', error);
            socket.emit('presence:error', { error: 'Failed to get presence status' });
        }
    });

    // Subscribe to presence updates for specific users
    socket.on('presence:subscribe', (userIds: string[]) => {
        if (!userIds || !Array.isArray(userIds)) {
            return;
        }

        for (const oderId of userIds) {
            socket.join(`presence:${oderId}`);
        }

        log.debug(`User ${socket.userId} subscribed to presence for ${userIds.length} users`);
    });

    // Unsubscribe from presence updates
    socket.on('presence:unsubscribe', (userIds: string[]) => {
        if (!userIds || !Array.isArray(userIds)) {
            return;
        }

        for (const oderId of userIds) {
            socket.leave(`presence:${oderId}`);
        }
    });

    // Ping to keep connection alive and update presence
    socket.on('presence:ping', async () => {
        try {
            await presenceService.refreshOnline(socket.userId);
            socket.emit('presence:pong', { timestamp: Date.now() });
        } catch (error: any) {
            log.error('Error handling presence ping:', error);
        }
    });

    // Set user as away (but still connected)
    socket.on('presence:away', async () => {
        // Could implement "away" status in the future
        // For now, just log it
        log.debug(`User ${socket.userId} set status to away`);
    });

    // Set user as active
    socket.on('presence:active', async () => {
        await presenceService.refreshOnline(socket.userId);
        log.debug(`User ${socket.userId} set status to active`);
    });
}

// Helper to broadcast presence change
export function broadcastPresenceChange(
    io: Server,
    userId: string,
    isOnline: boolean
): void {
    io.to(`presence:${userId}`).emit(isOnline ? 'user:online' : 'user:offline', {
        userId,
        timestamp: Date.now()
    });
}
