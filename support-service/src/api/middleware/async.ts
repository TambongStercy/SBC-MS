import { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async handler so its rejection reaches the error middleware. */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => { fn(req, res, next).catch(next); };
