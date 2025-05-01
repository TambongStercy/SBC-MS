/**
 * Custom application error base class.
 */
export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;

    constructor(message: string, statusCode: number, isOperational = true, stack = '') {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational; // Mark errors expected during operation

        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Error for bad requests (e.g., invalid input).
 */
export class BadRequestError extends AppError {
    constructor(message = 'Bad Request', stack = '') {
        super(message, 400, true, stack);
    }
}

/**
 * Error for resources not found.
 */
export class NotFoundError extends AppError {
    constructor(message = 'Resource Not Found', stack = '') {
        super(message, 404, true, stack);
    }
}

/**
 * Error for unauthorized access attempts.
 */
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', stack = '') {
        super(message, 401, true, stack);
    }
}

/**
 * Error for forbidden access attempts (user authenticated but lacks permission).
 */
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', stack = '') {
        super(message, 403, true, stack);
    }
} 