import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Basic Pino logger setup
const logger = pino({
    level: isProduction ? 'info' : 'debug', // Log less in production
    transport: isProduction
        ? undefined // Use default JSON transport in production
        : { target: 'pino-pretty', options: { colorize: true } } // Pretty print in development
});


// Function to create component-specific loggers
const getLogger = (componentName: string) => {
    return logger.child({ component: componentName });
};

export default { logger, getLogger }; // Export both the base logger and the function 