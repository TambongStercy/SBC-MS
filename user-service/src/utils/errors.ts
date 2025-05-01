// Define custom error class for application-specific errors
export class AppError extends Error {
    public statusCode: number;
    public isOperational: boolean; // To distinguish between operational and programmer errors

    constructor(message: string, statusCode: number, isOperational: boolean = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

// You can add more specific error classes here if needed, e.g.:
// export class AuthenticationError extends AppError { ... }
// export class ValidationError extends AppError { ... } 