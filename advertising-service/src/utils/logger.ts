import pino from 'pino';
import config from '../config'; // Import config to get log level

const isProduction = config.nodeEnv === 'production';

// Basic Pino logger setup
const loggerInstance = pino({
  level: config.logging.level || (isProduction ? 'info' : 'debug'),
  transport: isProduction
    ? undefined // Use default JSON transport in production
    : { target: 'pino-pretty', options: { colorize: true } } // Pretty print in development
});

// Function to create component-specific loggers
const getLogger = (componentName: string) => {
  return loggerInstance.child({ component: componentName });
};

// Export both the base logger instance and the function
export default { logger: loggerInstance, getLogger }; 