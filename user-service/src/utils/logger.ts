import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Define log formats
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
        (info) => `[${info.timestamp}] [${info.level}] [${info.service || 'user-service'}]: ${info.message}`
    )
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'user-service' },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat,
        }),
        // Error log file transport
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Combined log file transport
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Export a simplified interface for application use
export default {
    error: (message: string, meta?: any) => {
        logger.error(message, meta);
    },
    warn: (message: string, meta?: any) => {
        logger.warn(message, meta);
    },
    info: (message: string, meta?: any) => {
        logger.info(message, meta);
    },
    debug: (message: string, meta?: any) => {
        logger.debug(message, meta);
    },
    // Method to create a tagged logger for a specific component
    getLogger: (component: string) => {
        return {
            error: (message: string, meta?: any) => {
                logger.error(`[${component}] ${message}`, meta);
            },
            warn: (message: string, meta?: any) => {
                logger.warn(`[${component}] ${message}`, meta);
            },
            info: (message: string, meta?: any) => {
                logger.info(`[${component}] ${message}`, meta);
            },
            debug: (message: string, meta?: any) => {
                logger.debug(`[${component}] ${message}`, meta);
            },
        };
    },
}; 