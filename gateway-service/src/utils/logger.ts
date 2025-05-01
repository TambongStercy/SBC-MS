import winston from 'winston';
import path from 'path';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Define the format of logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define where logs should be stored
const transports = [
  // Console output
  new winston.transports.Console(),
  
  // Write all errors to error.log
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'error.log'),
    level: 'error',
  }),
  
  // Write all logs to combined.log
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'combined.log'),
  }),
];

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || level(),
  levels,
  format,
  transports,
});

// Create a factory function to get component-specific loggers
export function getLogger(component: string) {
  return {
    error: (message: string, meta?: any) => logger.error(`[${component}] ${message}`, meta),
    warn: (message: string, meta?: any) => logger.warn(`[${component}] ${message}`, meta),
    info: (message: string, meta?: any) => logger.info(`[${component}] ${message}`, meta),
    http: (message: string, meta?: any) => logger.http(`[${component}] ${message}`, meta),
    debug: (message: string, meta?: any) => logger.debug(`[${component}] ${message}`, meta),
  };
}

export default {
  logger,
  getLogger,
}; 