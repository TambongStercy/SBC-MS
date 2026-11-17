import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, BookOpen01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { kbApi } from '../../api/content';
import { errorMessage } from '../../api/http';
import type { ArticleStatus, KbArticle, KbArticleSummary, KbArticleVersion } from '../../api/types';
import { useCan } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge } from '../../components/display/labels';
import { toast } from '../../components/toast';
import {
  Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Panel, ResponsiveList, Segmented, Select, SheetContent, Skeleton, Textarea, type ListColumn,
} from '../../components/ui';
import { formatDateTime, formatRelative } from '../../lib/format';
import { SLUG_RE, slugify, TextPreview } from './text';

export const ARTICLE_STATUS: Record<ArticleStatus, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  draft: { label: 'Brouillon', tone: 'warning' },
  published: { label: 'Publié', tone: 'success' },
  archived: { label: 'Archivé', tone: 'neutral' },
};

type StatusFilter = 'all' | ArticleStatus;

const columns = (catLabel: (key: string) => string): ListColumn<KbArticleSummary>[] => [
  {
    key: 'title', header: 'Article',
    cell: a => (
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{a.title}</p>
        <p className="truncate font-mono text-xs text-fg-muted">{a.slug}</p>
      </div>
    ),
  },
  { key: 'status', header: 'Statut', cell: a => <StatusBadge map={ARTICLE_STATUS} value={a.status} /> },
  { key: 'category', header: 'Catégorie', cell: a => catLabel(a.category) },
  {
    key: 'version', header: 'Version',
    cell: a => <span className="tabular-nums">v{a.version}{a.publishedVersion ? <span className="text-fg-muted"> · publiée v{a.publishedVersion}</span> : null}</span>,
  },
  { key: 'updated', header: 'Modifié', cell: a => <span>{formatRelative(a.updatedAt)}{a.updatedBy ? <span className="text-fg-muted"> · {a.updatedBy.name}</span> : null}</span> },
];

export function ArticlesTab() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const search = useDeferredValue(q.trim());
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const categories = useQuery({ queryKey: ['kb', 'categories'], queryFn: kbApi.categories, staleTime: 5 * 60_000 });
  const cols = useMemo(() => {
    const labels = new Map((categories.data ?? []).map(c => [c.key, c.label]));
    return columns(k => labels.get(k) ?? k);
  }, [categories.data]);
  const list = useQuery({
    queryKey: ['kb', 'articles', search, status],
    queryFn: () => kbApi.list({ q: search || undefined, status: status === 'all' ? undefined : status }),
  });

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <HugeiconsIcon icon={Search01Icon} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un article" aria-label="Rechercher un article" className="pl-9" />
          </div>
          <Segmented label="Statut" size="sm" value={status} onValueChange={setStatus}
            options={[{ value: 'all', label: 'Tous' }, { value: 'draft', label: 'Brouillons' }, { value: 'published', label: 'Publiés' }, { value: 'archived', label: 'Archivés' }]} />
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}><HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" /> Nouvel article</Button>
      </div>
      <Panel>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
        ) : (
          <ResponsiveList rows={list.data ?? []} columns={cols} rowKey={a => a.id} loading={list.isLoading} onRowClick={a => setEditing(a.id)}
            empty={<EmptyState icon={BookOpen01Icon} title="Aucun article" description={search ? 'Aucun article ne correspond.' : 'Écrivez le premier article de l’espace Aide.'} />} />
        )}
      </Panel>
      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        {editing && <ArticleEditor id={editing === 'new' ? null : editing} onCreated={id => setEditing(id)} />}
      </Dialog>
    </>
  );
}

interface Draft { title: string; slug: string; category: string; body: string }
const EMPTY: Draft = { title: '', slug: '', category: '', body: '' };

function ArticleEditor({ id, onCreated }: { id: string | null; onCreated: (id: string) => void }) {
  const canPublish = useCan('kb.publish');
  const queryClient = useQueryClient();
  const article = useQuery({ queryKey: ['kb', 'article', id], queryFn: () => kbApi.get(id!), enabled: !!id });
  const categories = useQuery({ queryKey: ['kb', 'categories'], queryFn: kbApi.categories, staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'publish'; version: number } | { kind: 'unpublish' } | null>(null);

  useEffect(() => {
    if (!id) { setDraft(EMPTY); setSlugTouched(false); return; }
    if (article.data) {
      const a = article.data;
      setDraft({ title: a.title, slug: a.slug, category: a.category, body: a.body });
      setSlugTouched(true);
    }
  }, [id, article.data]);

  const set = (k: keyof Draft, v: string) => setDraft(d => ({
    ...d,
    [k]: v,
    ...(k === 'title' && !slugTouched ? { slug: slugify(v) } : {}),
  }));

  const loadVersion = (v: KbArticleVersion) => {
    setDraft(d => ({ ...d, title: v.title, body: v.body }));
    toast.info(`Version ${v.version} chargée dans l’éditeur. Enregistrez pour en faire un nouveau brouillon.`);
  };

  const refresh = (a: KbArticle) => {
    queryClient.setQueryData(['kb', 'article', a.id], a);
    void queryClient.invalidateQueries({ queryKey: ['kb', 'articles'] });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (draft.title.trim().length < 3) { setError('Donnez un titre d’au moins 3 caractères.'); return; }
    if (!SLUG_RE.test(draft.slug)) { setError('L’adresse ne peut contenir que des minuscules, des chiffres et des tirets.'); return; }
    if (!draft.category) { setError('Choisissez une catégorie.'); return; }
    if (draft.body.trim().length < 10) { setError('Le contenu est trop court.'); return; }
    setBusy(true);
    try {
      const body = { title: draft.title.trim(), slug: draft.slug, category: draft.category, body: draft.body };
      const a = id ? await kbApi.update(id, body) : await kbApi.create(body);
      refresh(a);
      toast.success(id ? `Brouillon v${a.version} enregistré.` : 'Article créé (brouillon).');
      if (!id) onCreated(a.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    if (!id || !confirm) return;
    setBusy(true);
    try {
      const a = confirm.kind === 'publish' ? await kbApi.publish(id, confirm.version) : await kbApi.unpublish(id);
      refresh(a);
      toast.success(confirm.kind === 'publish' ? 'Version publiée : les membres la voient maintenant.' : 'Article retiré de l’espace Aide.');
      setConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const catOptions = (categories.data ?? []).map(c => ({ value: c.key, label: c.label }));
  if (draft.category && !catOptions.some(o => o.value === draft.category)) catOptions.push({ value: draft.category, label: draft.category });
  const a = article.data;

  return (
    <SheetContent width="xl" title={id ? 'Modifier l’article' : 'Nouvel article'}
      description={a ? <span className="flex flex-wrap items-center gap-2"><StatusBadge map={ARTICLE_STATUS} value={a.status} /> v{a.version}{a.publishedVersion ? ` · publiée v${a.publishedVersion}` : ''}</span> : 'Enregistré comme brouillon : rien n’est visible des membres avant publication.'}>
      {id && article.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : id && article.isError ? (
        <ErrorState error={article.error} onRetry={() => article.refetch()} />
      ) : (
        <>
          <form onSubmit={save} className="flex flex-col gap-4" aria-label="Article">
            <Field label="Titre" required><Input value={draft.title} onChange={e => set('title', e.target.value)} /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Adresse (slug)" required help="Minuscules, chiffres et tirets. Change le lien de l’article.">
                <Input value={draft.slug} className="font-mono" onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} />
              </Field>
              <Field label="Catégorie" required>
                {categories.isError
                  ? <Input value={draft.category} onChange={e => set('category', e.target.value)} />
                  : <Select value={draft.category || undefined} onValueChange={v => set('category', v)} options={catOptions} placeholder="Choisir" />}
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">Contenu</span>
                <Segmented label="Mode" size="sm" value={mode} onValueChange={setMode} options={[{ value: 'write', label: 'Écrire' }, { value: 'preview', label: 'Aperçu' }]} />
              </div>
              {mode === 'write' ? (
                <Textarea aria-label="Contenu" rows={14} className="font-mono text-xs" value={draft.body} onChange={e => set('body', e.target.value)}
                  placeholder="Texte en Markdown. Une ligne vide sépare deux paragraphes." />
              ) : (
                <div className="min-h-40 rounded-control border border-line bg-surface-2 p-4"><TextPreview body={draft.body} /></div>
              )}
              <p className="text-xs text-fg-muted">Vidéos et PDF : téléversez-les depuis l’espace média, puis collez ici leur lien.</p>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy}>{id ? 'Enregistrer un nouveau brouillon' : 'Créer le brouillon'}</Button>
              {a?.status === 'published' && canPublish && <Button type="button" variant="danger-ghost" onClick={() => setConfirm({ kind: 'unpublish' })}>Dépublier</Button>}
            </div>
          </form>

          {a && a.versions.length > 0 && (
            <section className="mt-8" aria-label="Versions">
              <h3 className="mb-2 text-sm font-semibold text-fg">Versions</h3>
              <ul className="divide-y divide-line rounded-panel border border-line">
                {[...a.versions].sort((x, y) => y.version - x.version).map(v => (
                  <li key={v.version} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
                        <span className="font-medium tabular-nums">v{v.version}</span>
                        {v.published && <Badge tone="success">En ligne</Badge>}
                        <span className="truncate text-fg-muted">{v.title}</span>
                      </p>
                      <p className="text-xs text-fg-muted">{formatDateTime(v.createdAt)}{v.author ? ` · ${v.author.name}` : ''}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => loadVersion(v)}>Charger</Button>
                      {canPublish && !v.published && <Button size="sm" onClick={() => setConfirm({ kind: 'publish', version: v.version })}>Publier cette version</Button>}
                    </div>
                  </li>
                ))}
              </ul>
              {!canPublish && <p className="mt-2 text-xs text-fg-muted">La publication est réservée aux agents ayant le droit de publier.</p>}
            </section>
          )}
        </>
      )}

      <Dialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        {confirm && (
          <DialogContent size="sm"
            title={confirm.kind === 'publish' ? `Publier la version ${confirm.version} ?` : 'Dépublier l’article ?'}
            description={confirm.kind === 'publish' ? 'Les membres verront cette version dans l’espace Aide et l’assistant pourra la citer.' : 'L’article disparaît de l’espace Aide et l’assistant ne le cite plus.'}
            footer={<>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Annuler</Button>
              <Button variant={confirm.kind === 'publish' ? 'primary' : 'danger'} loading={busy} onClick={doConfirm}>{confirm.kind === 'publish' ? 'Publier' : 'Dépublier'}</Button>
            </>} />
        )}
      </Dialog>
    </SheetContent>
  );
}
