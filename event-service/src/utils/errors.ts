export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    /**
     * Machine-readable reason (e.g. SALES_NOT_OPEN), surfaced in the JSON body so
     * clients can branch without parsing the French message.
     */
    public readonly code?: string;
    /** Structured context for the client (e.g. which fields are locked). */
    public readonly details?: Record<string, unknown>;

    constructor(message: string, statusCode: number, isOperational: boolean = true, code?: string, details?: Record<string, unknown>) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.code = code;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}
