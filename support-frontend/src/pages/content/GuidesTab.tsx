import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon, Route01Icon } from '@hugeicons/core-free-icons';
import { guidesApi } from '../../api/content';
import { errorMessage } from '../../api/http';
import type { GuideNode } from '../../api/types';
import { useCan } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { toast } from '../../components/toast';
import { Badge, Button, Dialog, DialogContent, EmptyState, Input, Panel, Select, Skeleton, Tooltip } from '../../components/ui';
import { cn } from '../../lib/cn';
import { addChild, countDescendants, moveAt, newNode, removeAt, updateAt, validateTree, type Path } from './guideTree';

const KIND_OPTIONS = [
  { value: 'question', label: 'Question' },
  { value: 'article', label: 'Article' },
  { value: 'route', label: 'Parcours sécurisé' },
];
const ROUTE_OPTIONS = [
  { value: 'activation', label: 'Vérifier mon activation' },
  { value: 'withdrawal', label: 'Statut de mon retrait' },
  { value: 'ticket', label: 'Écrire au support' },
];
const routeLabel = (r?: string) => ROUTE_OPTIONS.find(o => o.value === r)?.label ?? r ?? '—';
/** Visual indent stops after 4 levels so deep trees still fit a 390 px screen. */
const MAX_INDENT = 4;

/** FAQ guided paths shown to members ("Mon compte n'est pas activé" → activation check…). */
export function GuidesTab() {
  const canEdit = useCan('kb.publish');
  const queryClient = useQueryClient();
  const guides = useQuery({ queryKey: ['guides'], queryFn: guidesApi.get });
  const [nodes, setNodes] = useState<GuideNode[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<{ path: Path; node: GuideNode } | null>(null);

  useEffect(() => {
    if (guides.data && !dirty) setNodes(guides.data.nodes);
  }, [guides.data, dirty]);

  const change = (next: GuideNode[]) => { setNodes(next); setDirty(true); setError(''); };

  const save = async () => {
    const problem = validateTree(nodes);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      const r = await guidesApi.save(nodes);
      queryClient.setQueryData(['guides'], r);
      setNodes(r.nodes);
      setDirty(false);
      toast.success('Parcours enregistrés : les membres les voient maintenant.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (guides.isLoading) return <Skeleton className="h-64 w-full" />;
  if (guides.isError) return <Panel><ErrorState error={guides.error} onRetry={() => guides.refetch()} /></Panel>;

  const render = (list: GuideNode[], parent: Path, depth: number) => (
    <ul className={cn('space-y-2', depth > 0 && 'mt-2', depth > 0 && depth <= MAX_INDENT && 'ml-3 border-l border-line pl-2')}>
      {list.map((node, i) => {
        const path = [...parent, i];
        return (
          <li key={node.id}>
            {canEdit ? (
              <NodeEditor
                node={node}
                first={i === 0}
                last={i === list.length - 1}
                onChange={patch => change(updateAt(nodes, path, patch))}
                onMove={dir => change(moveAt(nodes, path, dir))}
                onAdd={() => change(addChild(nodes, path, newNode()))}
                onDelete={() => (countDescendants(node) || node.label ? setToDelete({ path, node }) : change(removeAt(nodes, path)))}
              />
            ) : (
              <NodeView node={node} />
            )}
            {node.children.length > 0 && render(node.children, path, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[65ch] text-sm text-fg-muted">
          Chaque question mène à des sous-questions, à un article, ou à un parcours sécurisé (vérification d’activation, statut de retrait, ticket).
          {!canEdit && ' Consultation seule : la modification est réservée aux agents qui publient.'}
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={() => change(addChild(nodes, [], newNode()))}><HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" /> Question</Button>
            <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>Enregistrer</Button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mb-3 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {dirty && <p className="mb-3 text-xs text-warning">Modifications non enregistrées.</p>}
      <Panel className="p-3 sm:p-4">
        {nodes.length ? render(nodes, [], 0) : <EmptyState icon={Route01Icon} title="Aucun parcours" description={canEdit ? 'Ajoutez une première question.' : undefined} />}
      </Panel>

      <Dialog open={!!toDelete} onOpenChange={o => { if (!o) setToDelete(null); }}>
        {toDelete && (
          <DialogContent size="sm" title="Supprimer cette étape ?"
            description={`« ${toDelete.node.label || 'Sans titre'} »${countDescendants(toDelete.node) ? ` et ses ${countDescendants(toDelete.node)} sous-étapes` : ''} seront retirées (après enregistrement).`}
            footer={<>
              <Button variant="ghost" onClick={() => setToDelete(null)}>Annuler</Button>
              <Button variant="danger" onClick={() => { change(removeAt(nodes, toDelete.path)); setToDelete(null); }}>Supprimer</Button>
            </>} />
        )}
      </Dialog>
    </>
  );
}

function NodeView({ node }: { node: GuideNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
      <span className="font-medium text-fg">{node.label}</span>
      {node.kind === 'article' && <Badge tone="info">Article : <span className="font-mono">{node.articleSlug}</span></Badge>}
      {node.kind === 'route' && <Badge tone="primary">{routeLabel(node.route)}</Badge>}
    </div>
  );
}

function NodeEditor({ node, first, last, onChange, onMove, onAdd, onDelete }: {
  node: GuideNode;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<GuideNode>) => void;
  onMove: (dir: -1 | 1) => void;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const name = node.label || 'étape sans titre';
  const id = useId();
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-surface p-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={`${id}-kind`} className="sr-only">Type d’étape</label>
        <Select id={`${id}-kind`} value={node.kind} onValueChange={v => onChange({ kind: v as GuideNode['kind'] })} options={KIND_OPTIONS} className="sm:w-44" />
        <Input value={node.label} placeholder="Intitulé vu par le membre" aria-label="Intitulé" onChange={e => onChange({ label: e.target.value })} className="min-w-0 flex-1" />
        {node.kind === 'article' && (
          <Input value={node.articleSlug ?? ''} placeholder="adresse-de-l-article" aria-label="Adresse de l’article" className="font-mono sm:w-52"
            onChange={e => onChange({ articleSlug: e.target.value.toLowerCase() })} />
        )}
        {node.kind === 'route' && (
          <><label htmlFor={`${id}-route`} className="sr-only">Parcours sécurisé</label>
          <Select id={`${id}-route`} value={node.route} onValueChange={v => onChange({ route: v as GuideNode['route'] })} options={ROUTE_OPTIONS} placeholder="Parcours" className="sm:w-52" /></>
        )}
      </div>
      <div className="flex items-center gap-0.5 self-end sm:self-auto">
        <Tooltip content="Monter"><Button variant="ghost" size="icon-sm" aria-label={`Monter ${name}`} disabled={first} onClick={() => onMove(-1)}><HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden="true" /></Button></Tooltip>
        <Tooltip content="Descendre"><Button variant="ghost" size="icon-sm" aria-label={`Descendre ${name}`} disabled={last} onClick={() => onMove(1)}><HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden="true" /></Button></Tooltip>
        {node.kind === 'question' && (
          <Tooltip content="Ajouter une sous-étape"><Button variant="ghost" size="icon-sm" aria-label={`Ajouter une sous-étape à ${name}`} onClick={onAdd}><HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" /></Button></Tooltip>
        )}
        <Tooltip content="Supprimer"><Button variant="danger-ghost" size="icon-sm" aria-label={`Supprimer ${name}`} onClick={onDelete}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /></Button></Tooltip>
      </div>
    </div>
  );
}
