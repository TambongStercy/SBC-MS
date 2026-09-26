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
/**
 * Refusal to send another sign-in code yet. Carries the wait so the app can show
 * a countdown instead of letting the user tap "Renvoyer" into a wall.
 */
export class OtpThrottledError extends AppError {
    public retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
        super(
            `Un code vous a déjà été envoyé. Vérifiez votre boîte mail (et les spams), ou réessayez dans ${retryAfterSeconds} s.`,
            429,
        );
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, OtpThrottledError.prototype);
    }
}
