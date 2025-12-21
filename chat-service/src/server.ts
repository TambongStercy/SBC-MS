import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import connectDB from './database/connection';
import config from './config';
import apiRoutes from './api/routes/index';
import { initializeSocketServer, closeSocketServer } from './socket/socket.server';
import { presenceService } from './services/presence.service';
import logger from './utils/logger';

const log = logger.getLogger('Server');

const app: Express = express();
const httpServer = createServer(app);

// Security & Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
    origin: config.cors.origin,
    methods: config.cors.methods,
    allowedHeaders: config.cors.allowedHeaders,
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for production (behind Nginx)
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
}

// Request logging
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));

// Health check endpoints
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'chat-service',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'chat-service',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'chat-service',
        timestamp: new Date().toISOString()
    });
});

// Mount API routes
app.use('/api/chat', apiRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    log.error(`Uncaught error: ${err.message}`, { stack: err.stack });

    // Handle multer errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            message: 'File too large'
        });
    }

    if (err.message?.includes('Invalid') && err.message?.includes('type')) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || 'An unexpected error occurred',
        error: config.nodeEnv === 'development' ? err.stack : undefined
    });
});

// Start server
const PORT = config.port;

async function startServer() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Initialize Socket.IO
        initializeSocketServer(httpServer);

        // Start HTTP server
        httpServer.listen(PORT, config.host, () => {
            log.info(`Chat service running on http://${config.host}:${PORT}`);
            log.info(`Socket.IO ready for connections`);
            log.info(`Environment: ${config.nodeEnv}`);
        });

        // Graceful shutdown
        const gracefulShutdown = async (signal: string) => {
            log.info(`${signal} received, shutting down gracefully...`);

            // Close Socket.IO
            await closeSocketServer();

            // Close Redis connection
            await presenceService.close();

            // Close HTTP server
            httpServer.close(() => {
                log.info('HTTP server closed');
                process.exit(0);
            });

            // Force exit after 10 seconds
            setTimeout(() => {
                log.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error: any) {
        log.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

export { app, httpServer };
