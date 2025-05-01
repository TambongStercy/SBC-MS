/**
 * Custom error class for application-specific errors.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    /**
     * Creates an instance of AppError.
     * @param message - The error message.
     * @param statusCode - HTTP status code (e.g., 400, 404, 500).
     * @param isOperational - Flag indicating if it's an expected operational error (vs. a bug).
     */
    constructor(message: string, statusCode: number, isOperational: boolean = true) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype); // Restore prototype chain

        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Capture stack trace, excluding constructor call from it
        Error.captureStackTrace(this, this.constructor);
    }
}

// You can add more specific error types inheriting from AppError if needed
// export class NotFoundError extends AppError {
//     constructor(resource: string = 'Resource') {
//         super(`${resource} not found`, 404);
//     }
// }

// export class ValidationError extends AppError {
//     constructor(message: string = 'Invalid input') {
//         super(message, 400);
//     }
// } 