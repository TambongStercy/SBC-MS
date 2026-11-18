import request from 'supertest';
import { anonymizeQuestion, answerLooksUnsafe, classifySensitive } from '../utils/anonymize';
import { KbArticle } from '../database/models/kb.model';
import { BotConversation } from '../database/models/bot.model';
import { getApp, memberToken, mockFetch, setupDb, teardown } from './helpers';

describe('anonymiser', () => {
    it('removes phone numbers, emails, amounts and references', () => {
        const q = 'Bonjour, je suis jean.dupont@gmail.com, mon numéro +237 6 99 12 34 56 (ou 0699123456), '
            + 'j’ai payé 15 900 FCFA puis $37.1 et 5000F, référence SBX-OK-1731000000-ab12 et 6e2e00000000000000000b01, ticket SUP-000123, code ABC123XYZ';
        const out = anonymizeQuestion(q);
        expect(out).not.toMatch(/jean|dupont|gmail/i);
        expect(out).not.toMatch(/699|1234|0699/);
        expect(out).not.toMatch(/15 ?900|37\.1|5000/);
        expect(out).not.toMatch(/SBX|6e2e|SUP-000123|ABC123XYZ/);
        expect(out).toContain('[email]');
        expect(out).toContain('[numéro]');
        expect(out).toContain('[montant]');
        expect(out).toContain('[référence]');
        expect(out).not.toMatch(/\d{4,}/);
    });

    it('routes money and personal-account questions away from the AI', () => {
        expect(classifySensitive('Mon retrait est bloqué depuis 3 jours')).toBe('withdrawal');
        expect(classifySensitive('J’ai payé mais mon compte n’est pas activé')).toBe('activation');
        expect(classifySensitive('Où est ma commission ?')).toBe('ticket');
        expect(classifySensitive('Quel est mon solde ?')).toBe('ticket');
        expect(classifySensitive('Mon compte a été piraté')).toBe('ticket');
        expect(classifySensitive('Comment publier un statut WhatsApp ?')).toBeNull();
    });
});

describe('answer safety check', () => {
    it('keeps a help-article duration, refuses amounts, money deadlines and transaction statuses', () => {
        // A real DeepSeek answer (live test, 2026-11-18) that was wrongly discarded for its "24 heures".
        expect(answerLooksUnsafe('Collez la légende avec votre lien de suivi puis publiez [publier-statut]. Laissez le statut en ligne 24 heures et ne le masquez pas à vos contacts [publier-statut].')).toBe(false);
        expect(answerLooksUnsafe('Le retrait arrive en 24 heures [retraits].')).toBe(true);
        expect(answerLooksUnsafe('Votre paiement est confirmé sous 2 jours.')).toBe(true);
        expect(answerLooksUnsafe('Votre retrait a été envoyé.')).toBe(true);
        expect(answerLooksUnsafe('Le pack coûte 15 900 FCFA.')).toBe(true);
        expect(answerLooksUnsafe('Ouvrez WhatsApp et publiez le visuel [publier-statut].')).toBe(false);
    });
});

describe('/me/assistant/ask', () => {
    beforeEach(async () => {
        await setupDb();
        await KbArticle.create({
            slug: 'publier-statut', category: 'vues_whatsapp', tags: ['statut', 'whatsapp'], status: 'published',
            draft: { title: 'Publier un statut WhatsApp', summary: 'Les étapes pour publier le visuel', body: 'Ouvrez WhatsApp, onglet Actualités, ajoutez le visuel de la campagne puis publiez le statut.' },
            published: { title: 'Publier un statut WhatsApp', summary: 'Les étapes pour publier le visuel', body: 'Ouvrez WhatsApp, onglet Actualités, ajoutez le visuel de la campagne puis publiez le statut.', version: 1, at: new Date(), by: 'seed' },
            version: 1,
        });
    });
    afterAll(teardown);

    const ask = (body: object) => request(getApp()).post('/api/support/me/assistant/ask').set('Authorization', `Bearer ${memberToken()}`).send(body);

    it('never sends a money question to DeepSeek, even at level ai', async () => {
        const fetchMock = mockFetch({ 'deepseek.test': () => ({ json: { choices: [{ message: { content: 'x' } }] } }) });
        try {
            for (const question of ['Mon retrait de 20 000 F est bloqué', 'J’ai payé 15900 FCFA, mon compte n’est pas activé', 'Où est passé mon argent ?']) {
                const r = await ask({ question, level: 'ai' });
                expect(r.status).toBe(200);
                expect(r.body.data.source).toBe('route');
                expect(r.body.data.canEscalate).toBe(true);
            }
            expect(fetchMock.calls.filter((c) => c.url.includes('deepseek'))).toHaveLength(0);
        } finally {
            fetchMock.restore();
        }
    });

    it('level faq never calls DeepSeek; level ai sends only the anonymised question and published excerpts', async () => {
        const fetchMock = mockFetch({
            'deepseek.test': () => ({ json: { choices: [{ message: { content: 'Ouvrez l’onglet Actualités et publiez le visuel [publier-statut].' } }], usage: { prompt_tokens: 300, completion_tokens: 40 } } }),
        });
        try {
            const q = 'Comment publier le statut WhatsApp ? je suis paul@yahoo.fr au +22997001122';
            const faq = await ask({ question: q });
            expect(faq.body.data.source).toBe('faq');
            expect(faq.body.data.articles[0].slug).toBe('publier-statut');
            expect(fetchMock.calls).toHaveLength(0);

            const ai = await ask({ question: q, level: 'ai', conversationId: faq.body.data.conversationId });
            expect(ai.status).toBe(200);
            expect(ai.body.data.source).toBe('ai');
            // The citation marker is checked, then removed from what the member reads; the article comes as a link.
            expect(ai.body.data.answer).toBe('Ouvrez l’onglet Actualités et publiez le visuel.');
            expect(ai.body.data.articles.map((a: any) => a.slug)).toEqual(['publier-statut']);
            expect(ai.body.data.conversationId).toBe(faq.body.data.conversationId);
            const calls = fetchMock.calls.filter((c) => c.url.includes('deepseek'));
            expect(calls).toHaveLength(1);
            const sent = JSON.stringify(calls[0].body);
            expect(sent).not.toMatch(/paul|yahoo|97001122|22997/);
            expect(sent).toContain('publier-statut');
            expect(calls[0].body.messages[0].role).toBe('system');
            expect(calls[0].headers.authorization).toBe('Bearer test-deepseek-key');
            const conv = await BotConversation.findById(faq.body.data.conversationId).lean();
            expect(conv!.messages).toHaveLength(4);
            expect(conv!.aiCalls).toBe(1);
        } finally {
            fetchMock.restore();
        }
    });

    it('escalates a conversation to a ticket once', async () => {
        const fetchMock = mockFetch({ '127.0.0.1:9': () => ({ json: { success: true } }) });
        try {
            const a = await ask({ question: 'Comment publier le statut WhatsApp ?' });
            const esc = () => request(getApp()).post(`/api/support/me/assistant/${a.body.data.conversationId}/escalate`)
                .set('Authorization', `Bearer ${memberToken()}`).send({ category: 'vues_whatsapp' });
            const e1 = await esc();
            expect(e1.status).toBe(201);
            expect(e1.body.data.number).toMatch(/^SUP-\d{6}$/);
            const e2 = await esc();
            expect(e2.body.data.ticketId).toBe(e1.body.data.ticketId);
            // Another member cannot see it.
            const other = await request(getApp()).get(`/api/support/me/tickets/${e1.body.data.ticketId}`).set('Authorization', `Bearer ${memberToken('6e2e00000000000000000b02')}`);
            expect(other.status).toBe(404);
        } finally {
            fetchMock.restore();
        }
    });
});
