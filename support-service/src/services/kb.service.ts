import { Types } from 'mongoose';
import { TICKET_CATEGORIES, TICKET_CATEGORY_KEYS } from '../config/constants';
import { IKbArticle, KbArticle } from '../database/models/kb.model';
import { ResponseTemplate } from '../database/models/ticket.model';
import { badRequest, conflict, notFound } from '../utils/errors';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const MEDIA_URL = /^https:\/\/[^\s]+$/i;

function parseMedia(v: unknown) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, 10).map((m: any) => {
        if (!m || !['video', 'pdf', 'link'].includes(m.type) || typeof m.url !== 'string' || !MEDIA_URL.test(m.url)) {
            throw badRequest('Lien de média invalide (https uniquement).', 'BAD_MEDIA');
        }
        return { type: m.type, url: m.url.slice(0, 500), title: str(m.title, 120) || undefined };
    });
}

function parseContent(body: Record<string, unknown>) {
    const title = str(body.title, 200);
    const content = str(body.body, 50000);
    if (title.length < 3) throw badRequest('Titre trop court.', 'BAD_TITLE');
    if (content.length < 10) throw badRequest('Contenu trop court.', 'BAD_BODY');
    return { title, summary: str(body.summary, 500), body: content, media: parseMedia(body.media) };
}

const parseCategory = (v: unknown) => {
    if (typeof v !== 'string' || !TICKET_CATEGORY_KEYS.includes(v as any)) throw badRequest('Catégorie inconnue.', 'BAD_CATEGORY');
    return v;
};

const parseTags = (v: unknown) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => (t as string).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 20) : []);

const snapshot = (content: ReturnType<typeof parseContent>, version: number, by: string) => ({ ...content, version, at: new Date(), by });

export async function createArticle(body: Record<string, unknown>, by: string) {
    const slug = str(body.slug, 80).toLowerCase();
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw badRequest('Identifiant (slug) invalide : lettres minuscules, chiffres et tirets.', 'BAD_SLUG');
    const content = parseContent(body);
    try {
        const doc = await KbArticle.create({
            slug, category: parseCategory(body.category), tags: parseTags(body.tags), audience: body.audience === 'agent' ? 'agent' : 'member',
            status: 'draft', draft: content, published: null, version: 1, versions: [snapshot(content, 1, by)], updatedBy: by,
        });
        return doc.toObject();
    } catch (err: any) {
        if (err?.code === 11000) throw conflict('Cet identifiant existe déjà.', 'SLUG_TAKEN');
        throw err;
    }
}

/** Saves a new draft version (members keep seeing the published one). */
export async function updateDraft(id: string, body: Record<string, unknown>, by: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const a = await KbArticle.findById(id).lean();
    if (!a) throw notFound('Article introuvable.');
    const content = parseContent(body);
    const version = (a.version ?? 0) + 1;
    const set: Record<string, unknown> = { draft: content, updatedBy: by, version };
    if (body.category !== undefined) set.category = parseCategory(body.category);
    if (body.tags !== undefined) set.tags = parseTags(body.tags);
    if (body.slug !== undefined && str(body.slug, 80).toLowerCase() !== a.slug) {
        const slug = str(body.slug, 80).toLowerCase();
        if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw badRequest('Identifiant (slug) invalide.', 'BAD_SLUG');
        set.slug = slug;
    }
    try {
        const r = await KbArticle.findOneAndUpdate({ _id: id, version: a.version }, { $set: set, $push: { versions: { $each: [snapshot(content, version, by)], $slice: -50 } } }, { new: true }).lean();
        if (!r) throw conflict('L’article a changé entre-temps. Rechargez.', 'STATE_CHANGED');
        return r;
    } catch (err: any) {
        if (err?.code === 11000) throw conflict('Cet identifiant existe déjà.', 'SLUG_TAKEN');
        throw err;
    }
}

/** Publishes the current draft version (optionally checking it is the one the editor saw). */
export async function publish(id: string, by: string, expectedVersion?: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const a = await KbArticle.findById(id).lean();
    if (!a) throw notFound('Article introuvable.');
    if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== a.version) {
        throw conflict('Une version plus récente existe. Rechargez avant de publier.', 'STATE_CHANGED');
    }
    const published = { ...a.draft, version: a.version, at: new Date(), by };
    const r = await KbArticle.updateOne({ _id: id, version: a.version }, { $set: { published, status: 'published', updatedBy: by } });
    if (r.modifiedCount !== 1) throw conflict('L’article a changé entre-temps. Rechargez.', 'STATE_CHANGED');
    return KbArticle.findById(id).lean();
}

export async function unpublish(id: string, by: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const r = await KbArticle.findOneAndUpdate({ _id: id, status: 'published' }, { $set: { status: 'archived', updatedBy: by } }, { new: true }).lean();
    if (!r) throw conflict('Cet article n’est pas publié.', 'NOT_PUBLISHED');
    return r;
}

export async function listArticlesDesk(q: Record<string, unknown>) {
    const filter: Record<string, unknown> = {};
    if (typeof q.status === 'string' && q.status) filter.status = q.status;
    if (typeof q.category === 'string' && q.category) filter.category = q.category;
    if (typeof q.q === 'string' && q.q.trim()) {
        const esc = q.q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ 'draft.title': { $regex: esc, $options: 'i' } }, { slug: { $regex: esc, $options: 'i' } }];
    }
    return KbArticle.find(filter, { versions: 0 }).sort({ updatedAt: -1 }).limit(500).lean();
}

export async function getArticleDesk(id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const a = await KbArticle.findById(id).lean();
    if (!a) throw notFound('Article introuvable.');
    return a;
}

// ---------- Member side: published only ----------

const memberArticle = (a: IKbArticle) => ({
    slug: a.slug, category: a.category, tags: a.tags,
    title: a.published!.title, summary: a.published!.summary ?? '', body: a.published!.body, media: a.published!.media ?? [],
    updatedAt: a.published!.at,
});

export async function memberCategories() {
    const counts = await KbArticle.aggregate([{ $match: { status: 'published', audience: 'member' } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
    return TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label, articles: by[c.key] ?? 0 }));
}

export async function searchPublished(q: string, limit = 10, category?: string) {
    const text = q.trim().slice(0, 200);
    const filter: Record<string, unknown> = { status: 'published', audience: 'member' };
    if (category && TICKET_CATEGORY_KEYS.includes(category as any)) filter.category = category;
    if (!text) {
        const docs = await KbArticle.find(filter, { versions: 0, draft: 0 }).sort({ 'published.at': -1 }).limit(limit).lean();
        return docs.map((d) => ({ ...memberArticle(d as IKbArticle), score: 0 }));
    }
    const docs = await KbArticle.find({ ...filter, $text: { $search: text } }, { score: { $meta: 'textScore' }, versions: 0, draft: 0 })
        .sort({ score: { $meta: 'textScore' } }).limit(limit).lean();
    return docs.map((d: any) => ({ ...memberArticle(d as IKbArticle), score: d.score as number }));
}

export async function getPublishedBySlug(slug: string) {
    const a = await KbArticle.findOne({ slug: String(slug).toLowerCase(), status: 'published', audience: 'member' }, { versions: 0, draft: 0 }).lean();
    if (!a) throw notFound('Article introuvable.');
    return memberArticle(a as IKbArticle);
}

// ---------- Response templates ----------

export async function listTemplates(q: Record<string, unknown>, includeInactive: boolean) {
    const filter: Record<string, unknown> = includeInactive ? {} : { active: true };
    if (typeof q.category === 'string') filter.$or = [{ category: q.category }, { category: null }];
    return ResponseTemplate.find(filter).sort({ title: 1 }).limit(500).lean();
}

export async function saveTemplate(id: string | null, body: Record<string, unknown>, by: string) {
    const doc = {
        title: str(body.title, 120), body: str(body.body, 5000),
        category: typeof body.category === 'string' && TICKET_CATEGORY_KEYS.includes(body.category as any) ? body.category : null,
        language: body.language === 'en' ? 'en' : 'fr', active: body.active !== false, updatedBy: by,
    };
    if (doc.title.length < 3 || doc.body.length < 3) throw badRequest('Titre et texte obligatoires.', 'BAD_TEMPLATE');
    if (!id) return (await ResponseTemplate.create(doc)).toObject();
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const r = await ResponseTemplate.findByIdAndUpdate(id, { $set: doc }, { new: true }).lean();
    if (!r) throw notFound('Modèle introuvable.');
    return r;
}
