import { Router } from 'express';
import { authenticate, requireLaunched, authenticateServiceRequest, authorizeAdmin } from '../middleware/auth.middleware';
import eventRoutes from './event.routes';
import organizerRoutes from './organizer.routes';
import orderRoutes from './order.routes';
import resaleRoutes from './resale.routes';
import scanRoutes from './scan.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';
import meRoutes from './me.routes';

const router = Router();

// All sub-routers are mounted under `/tickets/*` to match the gateway proxy prefix
// `/api/tickets`. (We can't use `/events` — settings-service already owns that.)

// Unauthenticated feature-flag check for the launch gate.
router.get('/tickets/launch', (_req, res) => res.json({ success: true, data: { launchAt: process.env.EVENT_LAUNCH_AT || null } }));

// Service-to-service webhooks (payment-service callbacks etc.)
router.use('/tickets/webhooks', authenticateServiceRequest, webhookRoutes);

// Admin — auth + admin role checked at the gate; each route may add more.
router.use('/tickets/admin', authenticate, authorizeAdmin, adminRoutes);

// Organizer routes require auth + isApprovedOrganizer middleware (lives inside).
router.use('/tickets/organizer', authenticate, requireLaunched, organizerRoutes);

// Signed-in user's own resources (mes billets, mes revendes).
router.use('/tickets/me', authenticate, requireLaunched, meRoutes);

// Public discovery — cached, no auth required.
router.use('/tickets/public', eventRoutes);

// Signed-in ticket ordering.
router.use('/tickets/orders', authenticate, requireLaunched, orderRoutes);

// Signed-in resale marketplace actions.
router.use('/tickets/resale', authenticate, requireLaunched, resaleRoutes);

// QR scan — organizer-only, done inside scan.routes.
router.use('/tickets/scan', authenticate, requireLaunched, scanRoutes);

export default router;
