import { useDeferredValue, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookOpen01Icon, LockIcon, Message01Icon, NoteIcon, SentIcon } from '@hugeicons/core-free-icons';
import { kbApi, templatesApi } from '../../api/content';
import { errorMessage } from '../../api/http';
import { ticketsApi } from '../../api/tickets';
import type { KbArticleSummary, ResponseTemplate, Ticket } from '../../api/types';
import { toast } from '../../components/toast';
import { Badge, Button, Dialog, DialogContent, EmptyState, Input, Segmented, Skeleton, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { categoryLabel } from './shared';

/** Where the member app shows a published article (assumed path of the "Aide" section). */
export const memberArticlePath = (slug: string) => `/aide/articles/${slug}`;

type Mode = 'reply' | 'note';

/** Reply to the member, or write an internal note; insert a ready answer or a link to an article. */
export function Composer({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('reply');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<'template' | 'kb' | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const internal = mode === 'note';
  const closed = ticket.status === 'closed';

  const send = useMutation({
    mutationFn: () => ticketsApi.reply(ticket.id, { body: body.trim(), internal }),
    onSuccess: () => {
      setBody('');
      setError('');
      toast.success(internal ? 'Note interne ajoutée.' : 'Réponse envoyée au membre.');
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: e => setError(errorMessage(e)),
  });

  /** Inserts text at the cursor (or at the end), then puts the cursor after it. */
  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const sep = before && !before.endsWith('\n') && !before.endsWith(' ') ? ' ' : '';
    const next = `${before}${sep}${text}${body.slice(end)}`;
    setBody(next);
    setPicker(null);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = before.length + sep.length + text.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) { setError(internal ? 'Écrivez la note.' : 'Écrivez la réponse.'); return; }
    send.mutate();
  };

  return (
    <form onSubmit={submit} className={cn('rounded-panel border p-3 sm:p-4', internal ? 'border-dashed border-warning bg-warning-soft' : 'border-line bg-surface')} aria-label="Répondre">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Mode>
          label="Type de message"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'reply', label: 'Réponse au membre', icon: Message01Icon },
            { value: 'note', label: 'Note interne', icon: NoteIcon },
          ]}
        />
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicker('template')}>
            <HugeiconsIcon icon={Message01Icon} size={14} aria-hidden="true" /> Réponse prête
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicker('kb')}>
            <HugeiconsIcon icon={BookOpen01Icon} size={14} aria-hidden="true" /> Lien d’article
          </Button>
        </div>
      </div>
      {internal && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-fg">
          <HugeiconsIcon icon={LockIcon} size={14} aria-hidden="true" /> Note interne : visible des agents seulement, jamais du membre.
        </p>
      )}
      {closed && !internal && <p className="mt-3 text-xs text-fg-muted">Ce ticket est fermé : une réponse au membre le rouvre selon les règles du serveur.</p>}
      <label htmlFor="composer-body" className="sr-only">{internal ? 'Note interne' : 'Réponse'}</label>
      <Textarea
        id="composer-body"
        ref={ref}
        rows={5}
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={internal ? 'Ce que les autres agents doivent savoir…' : ticket.member.id ? 'Votre réponse au membre…' : 'Votre réponse (copie aussi envoyée par email)…'}
        className="mt-3 bg-surface"
        aria-invalid={error ? true : undefined}
      />
      {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant={internal ? 'ink' : 'primary'} loading={send.isPending}>
          <HugeiconsIcon icon={internal ? NoteIcon : SentIcon} size={16} aria-hidden="true" />
          {internal ? 'Ajouter la note' : 'Envoyer la réponse'}
        </Button>
      </div>

      <TemplatePicker open={picker === 'template'} onClose={() => setPicker(null)} category={ticket.category} onPick={t => insert(t.body)} />
      <KbPicker open={picker === 'kb'} onClose={() => setPicker(null)} onPick={a => insert(`${a.title} — ${memberArticlePath(a.slug)}`)} />
    </form>
  );
}

function TemplatePicker({ open, onClose, category, onPick }: { open: boolean; onClose: () => void; category: string; onPick: (t: ResponseTemplate) => void }) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState('');
  const q = useQuery({
    queryKey: ['templates', all ? 'all' : category],
    queryFn: () => templatesApi.list(all ? {} : { category }),
    enabled: open,
  });
  const needle = filter.trim().toLowerCase();
  const rows = (q.data ?? []).filter(t => !needle || t.title.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle));

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      {open && (
        <DialogContent size="lg" title="Réponses prêtes" description={all ? 'Toutes les catégories.' : `Catégorie : ${categoryLabel(category)}.`}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="tpl-filter" className="sr-only">Filtrer les réponses</label>
              <Input id="tpl-filter" type="search" placeholder="Filtrer…" value={filter} onChange={e => setFilter(e.target.value)} />
              <Button type="button" variant="ghost" size="md" onClick={() => setAll(a => !a)}>{all ? 'Cette catégorie' : 'Toutes les catégories'}</Button>
            </div>
            {q.isLoading ? <Skeleton className="h-32 w-full" /> : rows.length === 0 ? (
              <EmptyState title="Aucune réponse prête" description="Les réponses se créent dans Contenus." />
            ) : (
              <ul className="divide-y divide-line rounded-panel border border-line">
                {rows.map(t => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onPick(t)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg">{t.title}</span>
                        <Badge tone="outline">{t.language.toUpperCase()}</Badge>
                      </span>
                      <span className="line-clamp-2 text-xs text-fg-muted">{t.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function KbPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (a: KbArticleSummary) => void }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const q = useQuery({
    queryKey: ['kb', 'published', deferred],
    queryFn: () => kbApi.list({ status: 'published', q: deferred || undefined }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      {open && (
        <DialogContent size="lg" title="Lien vers un article" description="Articles publiés de l’aide. Le lien est inséré dans le message.">
          <div className="flex flex-col gap-3">
            <label htmlFor="kb-search" className="sr-only">Chercher un article</label>
            <Input id="kb-search" type="search" placeholder="Chercher un article…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            {q.isLoading ? <Skeleton className="h-32 w-full" /> : (q.data ?? []).length === 0 ? (
              <EmptyState title="Aucun article publié" description="Essayez d’autres mots." />
            ) : (
              <ul className="divide-y divide-line rounded-panel border border-line">
                {(q.data ?? []).map(a => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onPick(a)} className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface-2">
                      <span className="text-sm font-medium text-fg">{a.title}</span>
                      <span className="break-all font-mono text-xs text-fg-muted">{memberArticlePath(a.slug)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
