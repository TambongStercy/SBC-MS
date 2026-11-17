import type { GuideNode } from '../../api/types';

/** A node's position: indices from the root list down to the node. */
export type Path = number[];

export function newNode(kind: GuideNode['kind'] = 'question'): GuideNode {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, label: '', kind, children: [] };
}

/** Applies `fn` to the list that holds the node at `path` (immutably). */
function withParentList(nodes: GuideNode[], path: Path, fn: (list: GuideNode[], index: number) => GuideNode[]): GuideNode[] {
  if (path.length === 1) return fn(nodes, path[0]);
  const [head, ...rest] = path;
  return nodes.map((n, i) => (i === head ? { ...n, children: withParentList(n.children, rest, fn) } : n));
}

export function updateAt(nodes: GuideNode[], path: Path, patch: Partial<GuideNode>): GuideNode[] {
  return withParentList(nodes, path, (list, i) => list.map((n, j) => (j === i ? { ...n, ...patch } : n)));
}

export function removeAt(nodes: GuideNode[], path: Path): GuideNode[] {
  return withParentList(nodes, path, (list, i) => list.filter((_, j) => j !== i));
}

export function moveAt(nodes: GuideNode[], path: Path, dir: -1 | 1): GuideNode[] {
  return withParentList(nodes, path, (list, i) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** Adds `child` under the node at `path`, or at the root when `path` is empty. */
export function addChild(nodes: GuideNode[], path: Path, child: GuideNode): GuideNode[] {
  if (!path.length) return [...nodes, child];
  return withParentList(nodes, path, (list, i) => list.map((n, j) => (j === i ? { ...n, children: [...n.children, child] } : n)));
}

export function countDescendants(node: GuideNode): number {
  return node.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
}

/** First problem in the tree, in French, or null. */
export function validateTree(nodes: GuideNode[]): string | null {
  for (const n of nodes) {
    if (!n.label.trim()) return 'Chaque étape doit avoir un intitulé.';
    if (n.kind === 'article' && !n.articleSlug?.trim()) return `« ${n.label} » : indiquez l’adresse de l’article.`;
    if (n.kind === 'route' && !n.route) return `« ${n.label} » : choisissez le parcours sécurisé.`;
    if (n.kind !== 'question' && n.children.length) return `« ${n.label} » : seule une question peut avoir des sous-étapes.`;
    const sub = validateTree(n.children);
    if (sub) return sub;
  }
  return null;
}
