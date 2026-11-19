import { Router } from 'express';
import { ah } from '../../middleware/async';
import { actorOf, agentOf, reqCtx, requirePermission } from '../../middleware/agent-auth';
import * as kb from '../../../services/kb.service';
import { memberGuides, saveGuidesFromDesk, toDesk } from '../../../services/guides.service';
import { audit } from '../../../services/audit.service';
import { TICKET_CATEGORIES } from '../../../config/constants';
import { agentNames } from '../../presenters';

const router = Router();

function summary(a: any, names: Record<string, { id: string; name: string }>) {
    return {
        id: String(a._id), slug: a.slug, title: a.draft?.title ?? '', category: a.category, status: a.status, tags: a.tags ?? [],
        version: a.version, publishedVersion: a.published?.version ?? null, updatedAt: a.updatedAt,
        updatedBy: a.updatedBy ? names[a.updatedBy] ?? { id: a.updatedBy, name: '—' } : undefined,
    };
}

async function full(a: any) {
    const names = await agentNames([a.updatedBy, ...(a.versions ?? []).map((v: any) => v.by)]);
    return {
        ...summary(a, names), body: a.draft?.body ?? '', summary: a.draft?.summary ?? '', media: a.draft?.media ?? [],
        versions: (a.versions ?? []).slice().reverse().map((v: any) => ({
            version: v.version, title: v.title, body: v.body, createdAt: v.at,
            author: v.by ? names[v.by] ?? { id: v.by, name: '—' } : undefined, published: a.published?.version === v.version,
        })),
    };
}

router.get('/kb/categories', requirePermission('kb.edit'), (_req, res) => {
    res.json({ success: true, data: TICKET_CATEGORIES.map((c) => ({ key: c.key, label: c.label })) });
});

router.get('/kb/articles', requirePermission('kb.edit'), ah(async (req, res) => {
    const list = await kb.listArticlesDesk(req.query as any);
    const names = await agentNames(list.map((a) => a.updatedBy));
    res.json({ success: true, data: list.map((a) => summary(a, names)) });
}));

router.get('/kb/articles/:id', requirePermission('kb.edit'), ah(async (req, res) => {
    res.json({ success: true, data: await full(await kb.getArticleDesk(req.params.id)) });
}));

router.post('/kb/articles', requirePermission('kb.edit'), ah(async (req, res) => {
    const a = await kb.createArticle(req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'kb.created', target: { type: 'article', id: String(a._id) }, after: { slug: a.slug }, ...reqCtx(req) });
    res.status(201).json({ success: true, data: await full(a) });
}));

router.put('/kb/articles/:id', requirePermission('kb.edit'), ah(async (req, res) => {
    const a = await kb.updateDraft(req.params.id, req.body ?? {}, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'kb.draft_saved', target: { type: 'article', id: req.params.id }, after: { version: a.version }, ...reqCtx(req) });
    res.json({ success: true, data: await full(a) });
}));

router.post('/kb/articles/:id/publish', requirePermission('kb.publish'), ah(async (req, res) => {
    const a = await kb.publish(req.params.id, agentOf(req).id, req.body?.version);
    await audit({ actor: actorOf(req), action: 'kb.published', target: { type: 'article', id: req.params.id }, after: { version: a?.version }, ...reqCtx(req) });
    res.json({ success: true, data: await full(a) });
}));

router.post('/kb/articles/:id/unpublish', requirePermission('kb.publish'), ah(async (req, res) => {
    const a = await kb.unpublish(req.params.id, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'kb.unpublished', target: { type: 'article', id: req.params.id }, ...reqCtx(req) });
    res.json({ success: true, data: await full(a) });
}));

// ---- guided paths ----
router.get('/guides', requirePermission('kb.edit'), ah(async (_req, res) => {
    const g = await memberGuides();
    res.json({ success: true, data: { nodes: toDesk(g.nodes), updatedAt: g.updatedAt } });
}));

router.put('/guides', requirePermission('kb.publish'), ah(async (req, res) => {
    const g = await saveGuidesFromDesk(req.body?.nodes, agentOf(req).id);
    await audit({ actor: actorOf(req), action: 'guides.saved', after: { nodes: g.nodes.length }, ...reqCtx(req) });
    res.json({ success: true, data: { nodes: toDesk(g.nodes), updatedAt: g.updatedAt } });
}));

export default router;
