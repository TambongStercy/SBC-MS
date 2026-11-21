import pino from 'pino';

export const logger = pino({ name: 'risk-service', level: process.env.LOG_LEVEL || 'info', base: { service: 'risk-service' } });
export const childLogger = (component: string) => logger.child({ component });
