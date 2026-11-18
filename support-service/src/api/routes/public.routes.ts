import { Router } from 'express';
import { ah } from '../middleware/async';
import * as tickets from '../../services/ticket.service';
import { cleanContact } from '../../services/contact.service';
import { verifyTurnstile } from '../../services/auth/turnstile.service';
import { hit } from '../../lib/rate-limit';
import { auditSafe } from '../../services/audit.service';
import { badRequest, tooMany } from '../../utils/errors';
import { clientIp, userAgent } from '../../utils/client-ip';

/**
 * « Signaler un problème » without an account (`/api/support/public/*`), for
 * people who cannot sign in. Text only (no files: nothing would own them).
 * Abuse guards: Turnstile (when TURNSTILE_SECRET is set), a hidden field bots
 * fill, and limits per IP. The contact details are not proof of identity: the
 * desk shows the request as « sans compte, non vérifié ».
 */
const router = Router();

router.post('/tickets', ah(async (req, res) => {
    const ip = clientIp(req);
    const b = req.body ?? {};
    // A bot fills every field, including the one people never see: pretend it worked.
    if (typeof b.website === 'string' && b.website.trim()) {
        auditSafe({ actor: { type: 'anonymous' }, action: 'public.ticket.honeypot', result: 'denied', ip, userAgent: userAgent(req) });
        res.status(201).json({ success: true, data: { number: null } });
        return;
    }
    // Checked before the limit: a typo in the email must not use up the person's tries.
    const contact = cleanContact(b.contact, true)!;
    for (const [key, max, win] of [['hour', 3, 3600], ['day', 10, 24 * 3600]] as const) {
        const r = await hit(`public:ticket:${key}:${ip}`, max, win);
        if (!r.allowed) throw tooMany('Vous avez envoyé plusieurs demandes. Réessayez plus tard.', r.retryAfterSec);
    }
    if (!(await verifyTurnstile(typeof b.turnstileToken === 'string' ? b.turnstileToken : undefined, ip))) {
        throw badRequest('La vérification anti-robot a échoué. Rechargez la page et réessayez.', 'TURNSTILE_FAILED');
    }
    const t = await tickets.createTicket({
        memberId: null, contact, category: b.category, subject: b.subject, body: b.message ?? b.body,
        source: 'public', author: { type: 'member', id: null, name: contact.name },
    });
    auditSafe({ actor: { type: 'anonymous' }, action: 'public.ticket.created', target: { type: 'ticket', id: String(t._id) }, ip, userAgent: userAgent(req) });
    // The number only: without an account the request cannot be opened again from the app.
    res.status(201).json({ success: true, data: { number: t.number } });
}));

export default router;
