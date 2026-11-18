import { GUIDES, GuideNode } from '../config/guides';
import { GuideTree } from '../database/models/guide.model';
import { TICKET_CATEGORY_KEYS } from '../config/constants';
import { badRequest } from '../utils/errors';

/**
 * Guided paths. Stored in the member shape `{ id, label, text, action,
 * category, articles, children }` (the member app reads it as is); the desk
 * editor uses `{ id, label, kind, articleSlug, route, children }`, converted
 * here. Text and category the desk shape does not carry are kept from the
 * stored node with the same id.
 */

export async function memberGuides(): Promise<{ nodes: GuideNode[]; updatedAt: Date | null }> {
    const doc = await GuideTree.findOne({ key: 'member' }).lean();
    return { nodes: (doc?.nodes as GuideNode[]) ?? GUIDES, updatedAt: doc?.updatedAt ?? null };
}

// Each member action has its own desk route: mapping contact_change_self to 'ticket' turned the
// member's self-service contact change into "open a ticket" at the first save from the desk.
const ACTION_TO_ROUTE: Record<string, string> = { activation_check: 'activation', withdrawal_status: 'withdrawal', ticket: 'ticket', contact_change_self: 'contact' };
const ROUTE_TO_ACTION: Record<string, GuideNode['action']> = { activation: 'activation_check', withdrawal: 'withdrawal_status', ticket: 'ticket', contact: 'contact_change_self' };

export interface DeskGuideNode { id: string; label: string; kind: 'question' | 'article' | 'route'; articleSlug?: string; route?: string; children: DeskGuideNode[]; text?: string; category?: string }

export function toDesk(nodes: GuideNode[]): DeskGuideNode[] {
    return nodes.map((n) => ({
        id: n.id, label: n.label, text: n.text, category: n.category,
        kind: n.action ? 'route' : n.articles?.length && !n.children?.length ? 'article' : 'question',
        ...(n.action ? { route: ACTION_TO_ROUTE[n.action] ?? 'ticket' } : {}),
        ...(n.articles?.length ? { articleSlug: n.articles[0] } : {}),
        children: toDesk(n.children ?? []),
    }));
}

function index(nodes: GuideNode[], out = new Map<string, GuideNode>()) {
    for (const n of nodes) { out.set(n.id, n); index(n.children ?? [], out); }
    return out;
}

function fromDesk(input: unknown, old: Map<string, GuideNode>, depth = 0, count = { n: 0 }): GuideNode[] {
    if (!Array.isArray(input)) throw badRequest('Arbre invalide.', 'BAD_GUIDES');
    if (depth > 6) throw badRequest('Arbre trop profond (6 niveaux au plus).', 'BAD_GUIDES');
    return input.map((raw: any) => {
        if (++count.n > 300) throw badRequest('Arbre trop grand.', 'BAD_GUIDES');
        const id = typeof raw?.id === 'string' && /^[\w-]{1,60}$/.test(raw.id) ? raw.id : null;
        const label = typeof raw?.label === 'string' ? raw.label.trim().slice(0, 160) : '';
        if (!id || !label) throw badRequest('Chaque étape a un identifiant et un libellé.', 'BAD_GUIDES');
        const prev = old.get(id);
        const node: GuideNode = { id, label };
        const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 1000) : prev?.text;
        if (text) node.text = text;
        if (raw.kind === 'route') {
            node.action = ROUTE_TO_ACTION[raw.route] ?? (prev?.action ?? 'ticket');
            const category = typeof raw.category === 'string' ? raw.category : prev?.category;
            if (node.action === 'ticket' && category && TICKET_CATEGORY_KEYS.includes(category as any)) node.category = category;
        }
        if (raw.kind === 'article' || typeof raw.articleSlug === 'string') {
            const slug = String(raw.articleSlug || '').toLowerCase();
            if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw badRequest('Article invalide dans le parcours.', 'BAD_GUIDES');
            node.articles = [slug];
        }
        const children = fromDesk(raw.children ?? [], old, depth + 1, count);
        if (children.length) node.children = children;
        return node;
    });
}

export async function saveGuidesFromDesk(input: unknown, by: string) {
    const current = await memberGuides();
    const nodes = fromDesk(input, index(current.nodes));
    await GuideTree.updateOne({ key: 'member' }, { $set: { nodes, updatedBy: by } }, { upsert: true });
    return memberGuides();
}
