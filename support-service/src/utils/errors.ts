/** Error carried to the client as { success:false, message, code }. Messages are French. */
export class AppError extends Error {
    constructor(public statusCode: number, message: string, public code?: string, public details?: unknown) {
        super(message);
        this.name = 'AppError';
    }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(400, message, code, details);
export const unauthorized = (message = 'Session expirée. Reconnectez-vous.', code = 'UNAUTHORIZED') => new AppError(401, message, code);
export const forbidden = (message = 'Accès refusé.', code = 'FORBIDDEN') => new AppError(403, message, code);
export const notFound = (message = 'Ressource introuvable.', code = 'NOT_FOUND') => new AppError(404, message, code);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, message, code);
export const tooMany = (message = 'Trop de tentatives. Réessayez plus tard.', retryAfterSec?: number) =>
    new AppError(429, message, 'RATE_LIMITED', retryAfterSec ? { retryAfterSeconds: retryAfterSec } : undefined);

/** A service we depend on did not answer, or answered with a server error. */
export class DependencyError extends AppError {
    constructor(public service: string, public upstreamStatus?: number) {
        super(503, `${SERVICE_LABELS[service] ?? 'Service'} indisponible pour le moment. Réessayez plus tard.`, 'SERVICE_UNAVAILABLE');
        this.name = 'DependencyError';
    }
}

const SERVICE_LABELS: Record<string, string> = {
    user: 'Service membres',
    payment: 'Service paiement',
    advertising: 'Service publicité',
    notification: 'Service notifications',
    storage: 'Stockage des fichiers',
    deepseek: 'Assistant',
};
