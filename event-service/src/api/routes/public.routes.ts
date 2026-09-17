import { Router } from 'express';
import * as publicController from '../controllers/public.controller';

const router = Router();

// Server-rendered event landing served at /e/:slug (proxied by nginx). EJS view
// with OG meta tags so WhatsApp/Facebook show a preview when the link is shared.
router.get('/e/:slug', publicController.eventLanding);

export default router;
