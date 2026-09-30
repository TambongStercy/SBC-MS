import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as scanService from '../../services/scan.service';

export const scan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const { qrToken, expectedEventId, deviceInfo } = req.body || {};
        const result = await scanService.scanQr({
            scannedByUserId: user.userId,
            qrToken,
            expectedEventId,
            deviceInfo,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};
