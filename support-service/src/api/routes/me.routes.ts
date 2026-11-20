import { Router } from 'express';
import multer from 'multer';
import { ah } from '../middleware/async';
import { memberLimit, memberOf, requireMember } from '../middleware/member-auth';
import { memberGuides } from '../../services/guides.service';
import { TICKET_CATEGORIES, withdrawalStatusText } from '../../config/constants';
import { getPublishedBySlug, memberCategories, searchPublished } from '../../services/kb.service';
import { ask, escalate } from '../../services/assistant.service';
import * as tickets from '../../services/ticket.service';
import { MAX_ATTACHMENT_BYTES, storeAttachment } from '../../services/attachment.service';
import { memberActivationCheck, memberActivationStatus } from '../../services/activation.service';
import { memberWithdrawals } from '../../services/clients/payment.client';
import { scheduleActivationRecheck } from '../../jobs';
import { getSetting } from '../../services/settings.service';
import { notFound } from '../../utils/errors';
import { memberRealtimeToken } from '../../services/realtime.service';
import { cleanContact } from '../../services/contact.service';
import { recordClientErrors } from '../../services/client-error.service';

/** Member help space (/api/support/me/*), member JWT, any role. */
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });

router.use(requireMember);

// ---- knowledge base & guided paths ----
router.get('/kb/categories', ah(async (_req, res) => {
    res.json({ success: true, data: await memberCategories() });
}));

router.get('/kb/search', memberLimit('kb-search', 120, 3600, 'Trop de recherches. Réessayez dans un moment.'), ah(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const hits = await searchPublished(q, 20, category);
    res.json({ success: true, data: hits.map(({ body, ...h }) => ({ ...h, excerpt: body.slice(0, 280) })) });
}));

router.get('/kb/articles/:slug', ah(async (req, res) => {
    res.json({ success: true, data: await getPublishedBySlug(req.params.slug) });
}));

router.get('/guides', ah(async (_req, res) => {
    res.json({ success: true, data: (await memberGuides()).nodes });
}));

// ---- assistant ----
const assistantLimit = memberLimit('assistant', () => getSetting<number>('assistant.dailyQuestionsPerMember'), 24 * 3600,
    'Vous avez atteint le nombre de questions du jour. Ouvrez une demande à un agent si besoin.');

router.post('/assistant/ask', assistantLimit, ah(async (req, res) => {
    res.json({ success: true, data: await ask(memberOf(req).userId, req.body ?? {}) });
}));

router.post('/assistant/:conversationId/escalate',
    memberLimit('ticket-create', 5, 24 * 3600, 'Vous avez ouvert beaucoup de demandes aujourd’hui. Réessayez demain ou complétez une demande existante.'),
    ah(async (req, res) => {
        res.status(201).json({ success: true, data: await escalate(memberOf(req).userId, req.params.conversationId, req.body?.category, req.body?.replay) });
    }));

// ---- tickets ----
router.get('/tickets/categories', (_req, res) => {
    res.json({ success: true, data: TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label })) });
});

// ---- live updates: a listen-only LiveKit token for the member's own room ({ enabled:false } without LiveKit) ----
router.get('/realtime/token', ah(async (req, res) => {
    res.json({ success: true, data: await memberRealtimeToken(memberOf(req).userId) });
}));

router.get('/tickets', ah(async (req, res) => {
    res.json({ success: true, data: await tickets.listMemberTickets(memberOf(req).userId) });
}));

router.post('/tickets',
    memberLimit('ticket-create', 5, 24 * 3600, 'Vous avez ouvert beaucoup de demandes aujourd’hui. Réessayez demain ou complétez une demande existante.'),
    ah(async (req, res) => {
        const m = memberOf(req);
        const b = req.body ?? {};
        const t = await tickets.createTicket({
            memberId: m.userId, category: b.category, subject: b.subject, body: b.message ?? b.body, attachmentIds: b.attachmentIds,
            source: 'member', author: { type: 'member', id: m.userId }, replay: b.replay, contact: cleanContact(b.contact, false),
        });
        res.status(201).json({ success: true, data: tickets.memberView(t as any) });
    }));

router.get('/tickets/:id', ah(async (req, res) => {
    res.json({ success: true, data: await tickets.getMemberTicket(req.params.id, memberOf(req).userId) });
}));

router.post('/tickets/:id/messages', memberLimit('ticket-message', 60, 24 * 3600, 'Trop de messages aujourd’hui. Réessayez demain.'), ah(async (req, res) => {
    const b = req.body ?? {};
    res.json({ success: true, data: await tickets.memberReply(req.params.id, memberOf(req).userId, b.message ?? b.body, b.attachmentIds) });
}));

router.post('/tickets/:id/close', ah(async (req, res) => {
    res.json({ success: true, data: await tickets.memberClose(req.params.id, memberOf(req).userId) });
}));

/** Failed API calls the member's app hit (batched by the app): counted for the support analytics. */
router.post('/client-errors', memberLimit('client-errors', 500, 24 * 3600, 'Trop de rapports d’erreurs aujourd’hui.'), ah(async (req, res) => {
    res.status(202).json({ success: true, data: await recordClientErrors(memberOf(req).userId, req.body?.errors) });
}));

router.post('/attachments', memberLimit('attachments', 30, 24 * 3600, 'Trop de fichiers envoyés aujourd’hui.'), upload.single('file'), ah(async (req, res) => {
    const r = await storeAttachment(req.file, { type: 'member', id: memberOf(req).userId });
    res.status(201).json({ success: true, data: r });
}));

// ---- activation ----
router.get('/activation/status', ah(async (req, res) => {
    res.json({ success: true, data: await memberActivationStatus(memberOf(req).userId) });
}));

router.post('/activation/check', memberLimit('activation-check', 10, 3600, 'Trop de vérifications. Réessayez dans une heure.'), ah(async (req, res) => {
    res.json({ success: true, data: await memberActivationCheck(memberOf(req).userId, req.body ?? {}, scheduleActivationRecheck) });
}));

// ---- withdrawals (real status, plain French) ----
const presentWithdrawal = (w: any) => {
    const t = withdrawalStatusText(w.businessStatus);
    return {
        id: w.transactionId, amount: w.amount, currency: w.currency, method: w.method ?? null, businessStatus: w.businessStatus,
        statusLabel: t.label, explanation: t.explanation, createdAt: w.createdAt, updatedAt: w.updatedAt ?? null,
    };
};

router.get('/withdrawals', ah(async (req, res) => {
    const list = await memberWithdrawals(memberOf(req).userId, 20);
    res.json({ success: true, data: list.map(presentWithdrawal) });
}));

router.get('/withdrawals/:id', ah(async (req, res) => {
    const list = await memberWithdrawals(memberOf(req).userId, 50);
    const w = list.find((x) => x.transactionId === req.params.id);
    if (!w) throw notFound('Retrait introuvable.');
    res.json({ success: true, data: presentWithdrawal(w) });
}));

export default router;
