import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import config from '../../config';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('Error');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof AppError) {
        if (err.statusCode >= 500) log.warn(err.message, { code: err.code, path: req.path });
        res.status(err.statusCode).json({ success: false, message: err.message, code: err.code, ...(err.details ? { data: err.details } : {}) });
        return;
    }
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo au plus).' : 'Fichier refusé.';
        res.status(400).json({ success: false, message, code: 'FILE_REJECTED' });
        return;
    }
    if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ success: false, message: 'Requête invalide.', code: 'BAD_JSON' });
        return;
    }
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ success: false, message: 'Requête trop volumineuse.', code: 'TOO_LARGE' });
        return;
    }
    if (err?.name === 'CastError') {
        res.status(404).json({ success: false, message: 'Ressource introuvable.', code: 'NOT_FOUND' });
        return;
    }
    if (err?.name === 'ValidationError') {
        res.status(400).json({ success: false, message: 'Informations manquantes ou invalides.', code: 'VALIDATION_ERROR', data: { fields: Object.keys(err.errors || {}) } });
        return;
    }
    log.error('Unhandled error', { path: req.path, name: err?.name, message: err?.message });
    res.status(500).json({ success: false, message: 'Erreur interne. Réessayez.', code: 'INTERNAL', ...(config.isProd ? {} : { data: { message: err?.message } }) });
}
