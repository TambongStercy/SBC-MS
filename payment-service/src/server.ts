import express, { Express, Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import connectDB from './database/connection';
import config from './config/index';
import apiRoutes from './api/routes';
import logger from './utils/logger';
import { paymentProcessor } from './jobs/paymentProcessor';
import path from 'path';

// Create Express server
const app: Application = express();

// Apply middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            connectSrc: ["'self'", "https:"],
            fontSrc: ["'self'", "data:", "https:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'", "https:"],
        },
    },
})); // Security headers with custom CSP
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] })); // Cross-origin resource sharing
app.use(express.json()); // Parse JSON request body
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request body

// Set View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve Static Files (like CSS)
const assetServingPath = '/api/payments/static'; // URL path prefix
let diskStaticPath: string; // Actual path on disk

// if (config.nodeEnv === 'production') {
//     diskStaticPath = path.join(__dirname, 'public');
// } else {
//     diskStaticPath = path.join(__dirname, '../public');
// }

diskStaticPath = path.join(__dirname, '../public');
app.use(assetServingPath, express.static(diskStaticPath));
logger.info(`[Server] Serving static files from disk path: ${diskStaticPath} at URL path: ${assetServingPath}`);

// --- Trust Proxy --- 
// This is important for accurately getting req.ip behind a reverse proxy (like Nginx)
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1); // Trust the first proxy hop
}

// Set up logging
if (config.nodeEnv !== 'test') {
    app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
}

// Basic Route
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'payment-service',
        timestamp: new Date().toISOString(),
        ip: req.ip
    });
});

// Health Check Route
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        service: 'payment-service',
        timestamp: new Date().toISOString()
    });
});

// API Routes
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`[Server] Uncaught error: ${err.message}`);

    const statusCode = err.statusCode || 500;
    const message = err.message || 'An unexpected error occurred';

    res.status(statusCode).json({
        success: false,
        message,
        error: config.nodeEnv === 'development' ? err.stack : undefined
    });
});

// Start server
const PORT = config.port;

async function startServer() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Start payment processor
        paymentProcessor.start();

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`[Server] Payment service running on port ${PORT}`);
            logger.info(`[Server] Environment: ${config.nodeEnv}`);
        });

        // Handle shutdown
        const gracefulShutdown = () => {
            logger.info('[Server] Shutting down gracefully...');

            // Stop payment processor
            paymentProcessor.stop();

            process.exit(0);
        };

        // Signal handlers
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    } catch (error) {
        logger.error(`[Server] Failed to start server: ${error}`);
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

// Export for testing
export default app; 