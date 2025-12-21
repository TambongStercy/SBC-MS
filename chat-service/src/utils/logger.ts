import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
        (info) => `[${info.timestamp}] [${info.level}] [${info.service || 'chat-service'}]: ${info.message}`
    )
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'chat-service' },
    transports: [
        new winston.transports.Console({
            format: consoleFormat,
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 5,
        }),
    ],
});

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
    }
};
