import request from 'supertest';
import { KB_STARTER } from '../data/kb-starter';
import { createArticle, publish, searchPublished } from '../services/kb.service';
import { isHowToQuestion, relevantArticles, stripCitations } from '../services/assistant.service';
import { anonymizeQuestion } from '../utils/anonymize';
import { getApp, memberToken, mockFetch, setupDb, teardown } from './helpers';

async function seedStarter() {
    for (const a of KB_STARTER) {
        const doc = await createArticle({ ...a }, 'seed:kb-starter');
        await publish(String(doc._id), 'seed:kb-starter');
    }
}

const ask = (question: string, level: 'faq' | 'ai' = 'faq') =>
    request(getApp()).post('/api/support/me/assistant/ask').set('Authorization', `Bearer ${memberToken()}`).send({ question, level });

beforeEach(async () => { await setupDb(); await seedStarter(); });
afterAll(teardown);

describe('starter help articles', () => {
    it('are all valid, published, and found first from their own title', async () => {
        expect(new Set(KB_STARTER.map((a) => a.slug)).size).toBe(KB_STARTER.length);
        for (const a of KB_STARTER) {
            const hits = await searchPublished(a.title, 3);
            expect(hits[0]?.slug).toBe(a.slug);
        }
    });

    it('never ask for a password or a code: every such sentence is a "never"', () => {
        for (const a of KB_STARTER) {
            for (const sentence of a.body.split(/[.\n]/)) {
                // An instruction to the member ("envoyez", "donnez"…) about a code or password must be a "never".
                if (/\b(envoyez|donnez|communiquez|indiquez|transmettez|partagez)\b/i.test(sentence) && /(mot de passe|code)/i.test(sentence)) {
                    expect({ slug: a.slug, sentence: /jamais/i.test(sentence) }).toEqual({ slug: a.slug, sentence: true });
                }
            }
        }
    });
});

describe('assistant answers from the starter articles', () => {
    it('answers everyday questions with SBC’s own steps, never calling DeepSeek', async () => {
        const f = mockFetch({ 'deepseek': () => { throw new Error('DeepSeek must not be called'); } });
        try {
            const cases: [string, string, string | undefined][] = [
                ['Comment faire un retrait ?', 'faire-un-retrait', 'withdrawal'],
                ['Comment payer mon pack ?', 'payer-son-pack', 'activation'],
                ['J’ai oublié mon mot de passe', 'mot-de-passe-oublie', 'ticket'],
                ['Comment supprimer mon compte ?', 'mes-donnees-personnelles', 'ticket'],
                ['Comment filmer la preuve des vues de mon statut ?', 'diffuseur-preuve-video', undefined],
                ['Je ne reçois pas le code de connexion', 'code-de-connexion-non-recu', undefined],
                ['Comment partager mon lien de parrainage ?', 'partager-mon-lien-de-parrainage', undefined],
            ];
            for (const [q, slug, route] of cases) {
                const r = await ask(q);
                expect({ q, status: r.status, source: r.body.data.source, first: r.body.data.articles[0]?.slug, route: r.body.data.route ?? undefined })
                    .toEqual({ q, status: 200, source: 'faq', first: slug, route });
                // The steps themselves, not just a title.
                expect(r.body.data.answer.split('\n').length).toBeGreaterThan(2);
            }
            expect(f.calls.filter((c) => c.url.includes('deepseek'))).toHaveLength(0);
        } finally {
            f.restore();
        }
    });

    it('keeps the secure route for a personal problem, with related articles to read', async () => {
        const r = await ask('Mon retrait de 5000 F n’est toujours pas arrivé');
        expect(r.body.data.source).toBe('route');
        expect(r.body.data.route).toBe('withdrawal');
        expect(r.body.data.articles.map((a: any) => a.slug)).toContain('statut-de-mon-retrait');
        const hacked = await ask('Mon compte a été piraté, que faire ?');
        expect(hacked.body.data.source).toBe('route');
        expect(hacked.body.data.route).toBe('ticket');
    });

    it('a second ask on a money how-to goes to the secure route, not to the AI', async () => {
        const f = mockFetch({ 'deepseek': () => { throw new Error('DeepSeek must not be called'); } });
        try {
            const r = await ask('Comment faire un retrait ?', 'ai');
            expect(r.body.data.source).toBe('route');
            expect(r.body.data.route).toBe('withdrawal');
            expect(f.calls).toHaveLength(0);
        } finally {
            f.restore();
        }
    });
});

describe('picking the right article', () => {
    it('ranks by the question’s topic, and gives nothing for an off-topic question', async () => {
        const first = async (q: string) => (await relevantArticles(anonymizeQuestion(q)))[0]?.slug ?? null;
        // Live run 2026-11-18: these three picked the wrong article from MongoDB's single-word matches.
        expect(await first('Comment activer les notifications sur mon iPhone ?')).toBe('activer-les-notifications');
        expect(await first('Comment faire de la pub sans acheter de pack ?')).toBe('annonceur-sans-pack');
        expect(await first('Quel temps fait-il à Douala aujourd’hui ?')).toBeNull();
        expect(await first('Comment inviter quelqu’un à rejoindre SBC ?')).toBe('partager-mon-lien-de-parrainage');
        expect(await first('Quelle taille maximum pour la vidéo de preuve ?')).toBe('diffuseur-preuve-video');
    });

    it('an off-topic question at level ai does not call DeepSeek', async () => {
        const f = mockFetch({ 'deepseek': () => { throw new Error('DeepSeek must not be called'); } });
        try {
            const r = await ask('Quel temps fait-il à Douala aujourd’hui ?', 'ai');
            expect(r.body.data.articles).toEqual([]);
            expect(f.calls).toHaveLength(0);
        } finally {
            f.restore();
        }
    });

    it('removes citation markers and their dangling lead-ins', () => {
        expect(stripCitations('D’après [code-de-connexion-non-recu], vérifiez vos spams [code-de-connexion-non-recu].')).toBe('Vérifiez vos spams.');
        expect(stripCitations('Ouvrez Profil (voir [mes-filleuls]).')).toBe('Ouvrez Profil.');
        expect(stripCitations('Selon l’article [x-y], touchez Copier.')).toBe('Touchez Copier.');
    });
});

describe('how-to or personal problem', () => {
    it.each([
        ['Comment faire un retrait ?', true],
        ['J’ai oublié mon mot de passe', true],
        ['Où trouver mon lien de parrainage ?', true],
        ['Mon retrait n’est pas arrivé', false],
        ['Comment récupérer mes 5000 F ?', false],
        ['Mon compte est bloqué', false],
        ['On m’a volé mon compte, comment faire ?', false],
    ])('%s → %s', (q, expected) => {
        expect(isHowToQuestion(anonymizeQuestion(q))).toBe(expected);
    });
});
