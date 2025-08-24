/**
 * Custom error class for application-specific errors.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode: number, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Maintain proper stack trace (only available on V8 engines, like Node.js)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

// You can add more specific error types here if needed
// export class NotFoundError extends AppError {
//     constructor(message = 'Resource not found') {
//         super(message, 404);
//     }
// }

// export class ValidationError extends AppError {
//     constructor(message = 'Invalid input') {
//         super(message, 400);
//     }
// }

// export class AuthenticationError extends AppError {
//     constructor(message = 'Authentication failed') {
//         super(message, 401);
//     }
// }

// export class AuthorizationError extends AppError {
//     constructor(message = 'Not authorized') {
//         super(message, 403);
//     }
// } 