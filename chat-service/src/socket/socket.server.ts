import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { presenceService } from '../services/presence.service';
import { chatHandler } from './handlers/chat.handler';
import { statusHandler } from './handlers/status.handler';
import { presenceHandler } from './handlers/presence.handler';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SocketServer');

export interface AuthenticatedSocket extends Socket {
    userId: string;
    userName: string;
    userRole: string;
}

let io: Server | null = null;

export function getIO(): Server | null {
    return io;
}

export function initializeSocketServer(httpServer: HttpServer): Server {
    io = new Server(httpServer, {
        cors: {
            origin: config.cors.origin,
            methods: ['GET', 'POST'],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling']
    });

    // Authentication middleware
    io.use(async (socket: Socket, next) => {
        try {
            const token = socket.handshake.auth.token ||
                socket.handshake.headers.authorization?.split(' ')[1];

            if (!token) {
                log.warn('Socket connection rejected: No token provided');
                return next(new Error('Authentication token required'));
            }

            let decoded: JwtPayload;
            try {
                decoded = verifyToken(token);
            } catch (err) {
                log.warn('Socket connection rejected: Invalid token');
                return next(new Error('Invalid token'));
            }

            if (!decoded || !decoded.userId) {
                log.warn('Socket connection rejected: Invalid token payload');
                return next(new Error('Invalid token payload'));
            }

            // Attach user info to socket
            (socket as AuthenticatedSocket).userId = decoded.userId;
            (socket as AuthenticatedSocket).userName = decoded.name || '';
            (socket as AuthenticatedSocket).userRole = decoded.role || 'user';

            next();
        } catch (error: any) {
            log.error('Socket authentication error:', error.message);
            next(new Error('Authentication failed'));
        }
    });

    // Connection handler
    io.on('connection', async (socket: Socket) => {
        const authSocket = socket as AuthenticatedSocket;
        log.info(`User ${authSocket.userId} connected, socket: ${socket.id}`);

        // Join user's personal room for direct messages
        socket.join(`user:${authSocket.userId}`);

        // Mark user as online
        await presenceService.setOnline(authSocket.userId, socket.id);

        // Broadcast online status to all users
        io!.emit('user:online', { userId: authSocket.userId });

        // Register event handlers
        chatHandler(io!, authSocket);
        statusHandler(io!, authSocket);
        presenceHandler(io!, authSocket);

        // Heartbeat to keep presence alive
        const heartbeatInterval = setInterval(async () => {
            await presenceService.refreshOnline(authSocket.userId);
        }, 60000); // Every minute

        // Handle disconnection
        socket.on('disconnect', async (reason) => {
            log.info(`User ${authSocket.userId} disconnected: ${reason}`);
            clearInterval(heartbeatInterval);
            await presenceService.setOffline(authSocket.userId);
            io!.emit('user:offline', { userId: authSocket.userId });
        });

        // Handle errors
        socket.on('error', (error) => {
            log.error(`Socket error for user ${authSocket.userId}:`, error);
        });
    });

    log.info('Socket.IO server initialized');

    return io;
}

export function closeSocketServer(): Promise<void> {
    return new Promise((resolve) => {
        if (io) {
            io.close(() => {
                log.info('Socket.IO server closed');
                io = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}
