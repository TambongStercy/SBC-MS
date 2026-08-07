import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Basic Pino logger setup
const logger = pino({
    level: isProduction ? 'info' : 'debug', // Log less in production
    transport: isProduction
        ? undefined // Use default JSON transport in production
        : { target: 'pino-pretty', options: { colorize: true } } // Pretty print in development
});

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

// A logger that accepts a message first, with optional structured details after
// it (`log.error('message', errorOrObject)`). This keeps an ergonomic call
// order across the service while still emitting pino's structured logs.
export interface ComponentLogger {
    fatal(msg: string, ...details: unknown[]): void;
    error(msg: string, ...details: unknown[]): void;
    warn(msg: string, ...details: unknown[]): void;
    info(msg: string, ...details: unknown[]): void;
    debug(msg: string, ...details: unknown[]): void;
    trace(msg: string, ...details: unknown[]): void;
}

// Function to create component-specific loggers
const getLogger = (componentName: string): ComponentLogger => {
    const child = logger.child({ component: componentName });

    const make = (level: LogLevel) => (msg: string, ...details: unknown[]): void => {
        if (details.length === 0) {
            child[level](msg);
        } else {
            const payload = details.length === 1 ? details[0] : details;
            child[level]({ details: payload }, msg);
        }
    };

    return {
        fatal: make('fatal'),
        error: make('error'),
        warn: make('warn'),
        info: make('info'),
        debug: make('debug'),
        trace: make('trace'),
    };
};

export default { logger, getLogger }; // Export both the base logger and the function
