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

/** The member access token from the `sbc_at` cookie (Security plan Phase 9), or null. */
export function sessionCookieToken(raw: string | undefined): string | null {
    if (!raw) return null;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === 'sbc_at') {
            const v = part.slice(i + 1).trim();
            return v && v.length < 4096 ? v : null;
        }
    }
    return null;
}

/** A WebSocket handshake carries no CORS check: the Origin must be our own host. */
export function sameSiteOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin || !host) return false;
    try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

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
            let token = socket.handshake.auth.token ||
                socket.handshake.headers.authorization?.split(' ')[1];
            // Security plan Phase 9: the web app holds no token any more, only the HttpOnly
            // session cookie (SameSite=Strict). Accepted only from a page of our own site.
            if (!token) {
                const fromCookie = sessionCookieToken(socket.handshake.headers.cookie);
                if (fromCookie && sameSiteOrigin(socket.handshake.headers.origin, socket.handshake.headers.host)) token = fromCookie;
            }

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
