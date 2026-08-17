import { Router } from 'express';
import { renderLandingPage, handleAction } from '../controllers/public.controller';

/**
 * Public, unauthenticated routes. These URLs get pasted into WhatsApp statuses and
 * tapped by people who have never heard of SBC, so the paths are kept short and
 * mounted at the root rather than under /api.
 */
const router = Router();

// A diffuseur's tracking link. Doubles as their SBC affiliate link.
router.get('/s/:trackingCode', renderLandingPage);
router.get('/c/:trackingCode/:action', handleAction);

// The campaign's own URL, with no diffuseur attribution.
router.get('/a/:slug', renderLandingPage);
router.get('/c/slug/:slug/:action', handleAction);

export default router;
