import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { ah } from '../middleware/async';
import * as tickets from '../../services/ticket.service';
import { cleanContact } from '../../services/contact.service';
import { verifyTurnstile } from '../../services/auth/turnstile.service';
import { hit } from '../../lib/rate-limit';
import { auditSafe } from '../../services/audit.service';
import { badRequest, notFound, tooMany } from '../../utils/errors';
import { clientIp, userAgent } from '../../utils/client-ip';
import { MAX_ATTACHMENT_BYTES, storeAttachment } from '../../services/attachment.service';
import { guestRealtimeToken } from '../../services/realtime.service';

/**
 * « Signaler un problème » without an account (`/api/support/public/*`), for
 * people who cannot sign in. Text only (no files: nothing would own them).
 * Abuse guards: Turnstile (when TURNSTILE_SECRET is set), a hidden field bots
 * fill, and limits per IP. The contact details are not proof of identity: the
 * desk shows the request as « sans compte, non vérifié ».
 *
 * The person then chats with the agent like a member: creating the request gives
 * its device a key (`x-support-guest-key`) that opens that request only; reply
 * emails carry it too (after `#`, so it never reaches a server log).
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
    const key = await tickets.issueGuestKey(t._id);
    auditSafe({ actor: { type: 'anonymous' }, action: 'public.ticket.created', target: { type: 'ticket', id: String(t._id) }, ip, userAgent: userAgent(req) });
    res.status(201).json({ success: true, data: { id: String(t._id), number: t.number, key } });
}));

/** Opens one request with its key; a wrong key is a 404, as if the request did not exist. */
async function requireGuestKey(req: Request, _res: Response, next: NextFunction) {
    try {
        const ip = clientIp(req);
        // `Authorization: SupportKey <key>` from browsers (a header every CORS setup already allows),
        // or `x-support-guest-key` from other callers.
        const auth = req.header('authorization') ?? '';
        const key = auth.startsWith('SupportKey ') ? auth.slice(11).trim() : req.header('x-support-guest-key');
        if (!(await tickets.guestKeyOpens(req.params.id, key))) {
            const r = await hit(`public:key-fail:${ip}`, 30, 3600);
            if (!r.allowed) throw tooMany('Trop d’essais. Réessayez plus tard.', r.retryAfterSec);
            throw notFound('Demande introuvable. Ouvrez le lien reçu par email.');
        }
        next();
    } catch (err) {
        next(err);
    }
}

const perTicket = (name: string, max: number, message: string) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
        const r = await hit(`public:${name}:${req.params.id}`, max, 24 * 3600);
        if (!r.allowed) throw tooMany(message, r.retryAfterSec);
        next();
    } catch (err) {
        next(err);
    }
};

const guest = (req: Request) => ({ guestTicketId: req.params.id });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });

router.get('/tickets/:id', requireGuestKey, ah(async (req, res) => {
    res.json({ success: true, data: await tickets.getRequesterTicket(req.params.id, guest(req)) });
}));

router.post('/tickets/:id/messages', requireGuestKey, perTicket('message', 60, 'Trop de messages aujourd’hui. Réessayez demain.'), ah(async (req, res) => {
    const b = req.body ?? {};
    res.json({ success: true, data: await tickets.requesterReply(req.params.id, guest(req), b.message ?? b.body, b.attachmentIds) });
}));

router.post('/tickets/:id/close', requireGuestKey, ah(async (req, res) => {
    res.json({ success: true, data: await tickets.requesterClose(req.params.id, guest(req)) });
}));

router.post('/tickets/:id/attachments', requireGuestKey, perTicket('attachments', 20, 'Trop de fichiers envoyés aujourd’hui.'), upload.single('file'), ah(async (req, res) => {
    const r = await storeAttachment(req.file, { type: 'member', id: `guest:${req.params.id}` });
    res.status(201).json({ success: true, data: r });
}));

router.get('/tickets/:id/realtime/token', requireGuestKey, ah(async (req, res) => {
    res.json({ success: true, data: await guestRealtimeToken(req.params.id) });
}));

export default router;
