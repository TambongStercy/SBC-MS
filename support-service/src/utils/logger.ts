import pino from 'pino';
import { currentRequestId } from './request-context';

/**
 * JSON logs with the request id of the current request (x-request-id).
 * Secrets, codes, tokens and contact details are redacted by path; callers
 * must still never put them in a message string.
 */
const base = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    base: { service: 'support-service' },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
        const requestId = currentRequestId();
        return requestId ? { requestId } : {};
    },
    redact: {
        paths: [
            'password', '*.password', 'code', '*.code', 'backupCode', '*.backupCode', 'token', '*.token',
            'refreshToken', '*.refreshToken', 'authorization', '*.authorization', 'cookie', '*.cookie',
            'headers.authorization', 'headers.cookie', 'secret', '*.secret', 'otp', '*.otp',
            'phoneNumber', '*.phoneNumber', 'email', '*.email', 'newValue', '*.newValue',
        ],
        censor: '[redacted]',
    },
});

export interface ComponentLogger {
    error(msg: string, details?: unknown): void;
    warn(msg: string, details?: unknown): void;
    info(msg: string, details?: unknown): void;
    debug(msg: string, details?: unknown): void;
}

const getLogger = (component: string): ComponentLogger => {
    const child = base.child({ component });
    const make = (level: 'error' | 'warn' | 'info' | 'debug') => (msg: string, details?: unknown) => {
        if (details === undefined) child[level](msg);
        else if (details instanceof Error) child[level]({ err: { message: details.message, name: details.name } }, msg);
        else child[level]({ details }, msg);
    };
    return { error: make('error'), warn: make('warn'), info: make('info'), debug: make('debug') };
};

export default { logger: base, getLogger };
