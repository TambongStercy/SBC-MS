import { Router } from 'express';
import { recoveryController } from '../controllers/recovery.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Internal routes (no auth required, using service-to-service authentication)
router.post('/internal/recovery/process-user-registration', (req, res, next) => 
    recoveryController.processUserRegistration(req, res, next)
);

router.get('/internal/recovery/user-stats', (req, res, next) => 
    recoveryController.getUserRecoveryStats(req, res, next)
);

// Admin routes (require authentication)
router.get('/admin/recovery/stats', authMiddleware, (req, res, next) => 
    recoveryController.getRecoveryStats(req, res, next)
);

router.get('/admin/recovery/records', authMiddleware, (req, res, next) => 
    recoveryController.listRecoveryRecords(req, res, next)
);

router.post('/admin/recovery/run', authMiddleware, (req, res, next) => 
    recoveryController.runRecovery(req, res, next)
);

router.get('/admin/recovery/records/:id', authMiddleware, (req, res, next) => 
    recoveryController.getRecoveryRecord(req, res, next)
);

router.post('/admin/recovery/records/:id/mark-restored', authMiddleware, (req, res, next) => 
    recoveryController.markRecordAsRestored(req, res, next)
);

export default router;