import { Request } from 'express';
import { Types } from 'mongoose';

// Define the structure of the user object attached to the request
interface AuthenticatedUser {
    userId: string | Types.ObjectId; // Or Types.ObjectId if preferred
    email: string;
    role: string; // Or use your UserRole enum
    id?: string | Types.ObjectId; // Optional depending on token payload
}

// Extend the Express Request interface
declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}

// Define Pagination Options separately if used elsewhere
export interface PaginationOptions {
    page: number;
    limit: number;
}

// Ensure this file is treated as a module.
export { }; 