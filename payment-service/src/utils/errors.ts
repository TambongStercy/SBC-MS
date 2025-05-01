/**
 * Custom error class for application-specific errors.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Ensure the correct prototype chain for instanceof checks
        Object.setPrototypeOf(this, AppError.prototype);

        // Capture stack trace, excluding constructor call from it
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// You can add other custom error types here if needed, extending AppError
// export class NotFoundError extends AppError { ... }
// export class ValidationError extends AppError { ... } 