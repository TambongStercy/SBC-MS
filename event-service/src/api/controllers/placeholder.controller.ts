import { Request, Response } from 'express';

/**
 * Stub used by V1 routes that are wired but not yet implemented. Returns 501 so
 * frontend integration surfaces gaps loudly instead of silently swallowing them.
 */
export const notImplemented = (route: string) => (_req: Request, res: Response) => {
    res.status(501).json({
        success: false,
        message: `${route} is not implemented yet (SBC Event V1 scaffold).`,
    });
};
