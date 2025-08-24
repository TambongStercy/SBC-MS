import { Router } from 'express';
import { recoveryController } from '../controllers/recovery.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public routes (no auth required - for frontend integration)
router.post('/recovery/check-login', (req, res, next) => 
    recoveryController.checkLoginRecovery(req, res, next)
);

router.post('/recovery/check-registration', (req, res, next) => 
    recoveryController.checkRegistrationRecovery(req, res, next)
);

router.post('/recovery/notification', (req, res, next) => 
    recoveryController.getRecoveryNotification(req, res, next)
);

// Internal routes (no auth required, using service-to-service authentication)
router.post('/internal/recovery/process-user-registration', (req, res, next) => 
    recoveryController.processUserRegistration(req, res, next)
);

router.get('/internal/recovery/user-stats', (req, res, next) => 
    recoveryController.getUserRecoveryStats(req, res, next)
);

// Admin routes (require authentication)
router.get('/admin/recovery/stats', authenticate, (req, res, next) => 
    recoveryController.getRecoveryStats(req, res, next)
);

router.get('/admin/recovery/records', authenticate, (req, res, next) => 
    recoveryController.listRecoveryRecords(req, res, next)
);

router.post('/admin/recovery/run', authenticate, (req, res, next) => 
    recoveryController.runRecovery(req, res, next)
);

router.get('/admin/recovery/records/:id', authenticate, (req, res, next) => 
    recoveryController.getRecoveryRecord(req, res, next)
);

router.post('/admin/recovery/records/:id/mark-restored', authenticate, (req, res, next) => 
    recoveryController.markRecordAsRestored(req, res, next)
);

export default router;