import { Router } from 'express';
import { csrfProtection, requireAgent } from '../../middleware/agent-auth';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import approvalRoutes from './approvals.routes';
import memberRoutes from './members.routes';
import ticketRoutes from './tickets.routes';
import kbRoutes from './kb.routes';
import financeRoutes from './finance.routes';
import viewRoutes from './views.routes';
import reportRoutes from './reports.routes';

/** Agent desk (/api/support/desk/*). CSRF + Origin on every mutation, agent session on everything but sign-in. */
const router = Router();
router.use(csrfProtection);
router.use('/auth', authRoutes);
router.use(requireAgent);
router.use('/', adminRoutes);
router.use('/approvals', approvalRoutes);
router.use('/members', memberRoutes);
router.use('/', ticketRoutes);
router.use('/', kbRoutes);
router.use('/', financeRoutes);
router.use('/views', viewRoutes);
router.use('/', reportRoutes);

export default router;
