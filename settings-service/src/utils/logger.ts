import winston from 'winston';
import path from 'path';
import fs from 'fs';
import config from '../config';

// Ensure log directory exists
const logDir = config.log.logDir;
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} ${info.message}`)
);

const logger = winston.createLogger({
    level: config.log.level || 'info', // Default level
    format: logFormat,
    transports: [
        // Console transport for development/debugging
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(), // Add color
                logFormat
            )
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logDir, 'service.log'),
            level: 'debug' // Log everything to the main file
        }),
        // File transport for errors only
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error'
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })
    ],
    exitOnError: false // Do not exit on handled exceptions
});

// Wrapper to easily get component-specific loggers (optional but good practice)
class LoggerWrapper {
    getLogger(componentName: string) {
        return {
            error: (message: string, ...meta: any[]) => logger.error(`[${componentName}] ${message}`, ...meta),
            warn: (message: string, ...meta: any[]) => logger.warn(`[${componentName}] ${message}`, ...meta),
            info: (message: string, ...meta: any[]) => logger.info(`[${componentName}] ${message}`, ...meta),
            debug: (message: string, ...meta: any[]) => logger.debug(`[${componentName}] ${message}`, ...meta),
            verbose: (message: string, ...meta: any[]) => logger.verbose(`[${componentName}] ${message}`, ...meta),
        };
    }
}

export default new LoggerWrapper(); 