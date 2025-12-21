import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../socket.server';
import { statusService } from '../../services/status.service';
import logger from '../../utils/logger';

const log = logger.getLogger('StatusHandler');

export function statusHandler(io: Server, socket: AuthenticatedSocket) {
    // Subscribe to status feed updates
    socket.on('status:subscribe', (categories?: string[]) => {
        // Join the main status room
        socket.join('status:feed');

        // Join category-specific rooms if specified
        if (categories && categories.length > 0) {
            for (const category of categories) {
                socket.join(`status:category:${category}`);
            }
            log.debug(`User ${socket.userId} subscribed to status categories: ${categories.join(', ')}`);
        } else {
            // Join all category rooms
            socket.join('status:all');
            log.debug(`User ${socket.userId} subscribed to all statuses`);
        }
    });

    // Unsubscribe from status feed
    socket.on('status:unsubscribe', (categories?: string[]) => {
        if (categories && categories.length > 0) {
            for (const category of categories) {
                socket.leave(`status:category:${category}`);
            }
        } else {
            socket.leave('status:feed');
            socket.leave('status:all');
        }
        log.debug(`User ${socket.userId} unsubscribed from statuses`);
    });

    // Like a status
    socket.on('status:like', async (statusId: string) => {
        try {
            const result = await statusService.likeStatus(statusId, socket.userId);

            // Broadcast to all users viewing statuses
            io.to('status:feed').emit('status:liked', {
                statusId,
                userId: socket.userId,
                userName: socket.userName,
                likesCount: result.likesCount
            });

            // Notify status author
            if (result.authorId && result.authorId !== socket.userId) {
                io.to(`user:${result.authorId}`).emit('notification:new', {
                    type: 'status_like',
                    statusId,
                    fromUserId: socket.userId,
                    fromUserName: socket.userName,
                    message: `${socket.userName} liked your status`
                });
            }

            log.debug(`User ${socket.userId} liked status ${statusId}`);
        } catch (error: any) {
            log.error('Error liking status:', error);
            socket.emit('status:error', { error: 'Failed to like status' });
        }
    });

    // Unlike a status
    socket.on('status:unlike', async (statusId: string) => {
        try {
            const result = await statusService.unlikeStatus(statusId, socket.userId);

            io.to('status:feed').emit('status:unliked', {
                statusId,
                userId: socket.userId,
                likesCount: result.likesCount
            });

            log.debug(`User ${socket.userId} unliked status ${statusId}`);
        } catch (error: any) {
            log.error('Error unliking status:', error);
            socket.emit('status:error', { error: 'Failed to unlike status' });
        }
    });

    // Repost a status
    socket.on('status:repost', async (statusId: string) => {
        try {
            const result = await statusService.repostStatus(statusId, socket.userId);

            io.to('status:feed').emit('status:reposted', {
                statusId,
                userId: socket.userId,
                userName: socket.userName,
                repostsCount: result.repostsCount
            });

            log.debug(`User ${socket.userId} reposted status ${statusId}`);
        } catch (error: any) {
            log.error('Error reposting status:', error);
            socket.emit('status:error', { error: 'Failed to repost status' });
        }
    });

    // View a status (increment view count)
    socket.on('status:view', async (statusId: string) => {
        try {
            await statusService.incrementViewCount(statusId, socket.userId);
            // Don't broadcast views to avoid noise
        } catch (error: any) {
            log.error('Error recording status view:', error);
        }
    });

    // Reply to status (open chat)
    socket.on('status:reply', async (statusId: string) => {
        try {
            const result = await statusService.replyToStatus(statusId, socket.userId);

            // Send conversation ID back to user
            socket.emit('status:reply:success', {
                statusId,
                conversationId: result.conversationId
            });

            log.debug(`User ${socket.userId} started reply conversation for status ${statusId}`);
        } catch (error: any) {
            log.error('Error replying to status:', error);
            socket.emit('status:error', { error: error.message || 'Failed to reply to status' });
        }
    });

    // New status created (broadcast to feed)
    // This is called internally when a status is created via REST API
    socket.on('status:created', async (statusData: any) => {
        // Broadcast new status to feed
        io.to('status:feed').emit('status:new', statusData);

        // Also emit to category-specific room
        if (statusData.category) {
            io.to(`status:category:${statusData.category}`).emit('status:new', statusData);
        }
    });
}

// Helper function to broadcast new status (called from REST controller)
export function broadcastNewStatus(io: Server, status: any): void {
    io.to('status:feed').emit('status:new', status);

    if (status.category) {
        io.to(`status:category:${status.category}`).emit('status:new', status);
    }
}

// Helper function to broadcast status deletion
export function broadcastStatusDeleted(io: Server, statusId: string): void {
    io.to('status:feed').emit('status:deleted', { statusId });
}
