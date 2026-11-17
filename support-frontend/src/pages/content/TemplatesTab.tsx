import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Message01Icon } from '@hugeicons/core-free-icons';
import { templatesApi } from '../../api/content';
import { errorMessage } from '../../api/http';
import type { ResponseTemplate } from '../../api/types';
import { useCan } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { TICKET_CATEGORY } from '../../components/display/labels';
import { toast } from '../../components/toast';
import {
  Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Panel, ResponsiveList, Segmented, Select, Textarea, type ListColumn,
} from '../../components/ui';
import { formatRelative } from '../../lib/format';
import { TextPreview } from './text';

const categoryLabel = (c: string) => TICKET_CATEGORY[c] ?? c;
const CATEGORY_OPTIONS = Object.entries(TICKET_CATEGORY).map(([value, label]) => ({ value, label }));
const LANG_LABEL = { fr: 'Français', en: 'Anglais' } as const;

const COLUMNS: ListColumn<ResponseTemplate>[] = [
  { key: 'title', header: 'Réponse', cell: t => <span className="font-medium text-fg">{t.title}</span> },
  { key: 'category', header: 'Catégorie', cell: t => categoryLabel(t.category) },
  { key: 'language', header: 'Langue', cell: t => <Badge tone="outline">{t.language.toUpperCase()}</Badge> },
  { key: 'updated', header: 'Modifiée', cell: t => (t.updatedAt ? formatRelative(t.updatedAt) : '—') },
];

type Draft = Omit<ResponseTemplate, 'id' | 'updatedAt'>;
const EMPTY: Draft = { title: '', category: 'other', language: 'fr', body: '' };

/** Ready-made replies agents insert in tickets; managed with `templates.manage`. */
export function TemplatesTab() {
  const canManage = useCan('templates.manage');
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['templates'], queryFn: () => templatesApi.list() });
  const [open, setOpen] = useState<ResponseTemplate | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<ResponseTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await templatesApi.remove(toDelete.id);
      toast.success('Réponse supprimée.');
      setToDelete(null);
      setOpen(null);
      void refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">
          {canManage ? 'Les agents insèrent ces réponses dans les tickets, puis les adaptent.' : 'Consultation seule : la gestion des réponses est réservée aux responsables.'}
        </p>
        {canManage && <Button variant="primary" onClick={() => setOpen('new')}><HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" /> Nouvelle réponse</Button>}
      </div>
      <Panel>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
        ) : (
          <ResponsiveList rows={list.data ?? []} columns={COLUMNS} rowKey={t => t.id} loading={list.isLoading} onRowClick={t => setOpen(t)}
            empty={<EmptyState icon={Message01Icon} title="Aucune réponse prête" />} />
        )}
      </Panel>

      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
        {open && (canManage
          ? <TemplateEditor template={open === 'new' ? null : open} onDone={() => { setOpen(null); void refresh(); }} onDelete={t => setToDelete(t)} />
          : open !== 'new' && (
            <DialogContent title={open.title} description={`${categoryLabel(open.category)} · ${LANG_LABEL[open.language] ?? open.language}`}>
              <TextPreview body={open.body} />
            </DialogContent>
          ))}
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={o => { if (!o) setToDelete(null); }}>
        {toDelete && (
          <DialogContent size="sm" title="Supprimer cette réponse ?" description={`« ${toDelete.title} » ne sera plus proposée aux agents.`}
            footer={<>
              <Button variant="ghost" onClick={() => setToDelete(null)}>Annuler</Button>
              <Button variant="danger" loading={deleting} onClick={remove}>Supprimer</Button>
            </>} />
        )}
      </Dialog>
    </>
  );
}

function TemplateEditor({ template, onDone, onDelete }: { template: ResponseTemplate | null; onDone: () => void; onDelete: (t: ResponseTemplate) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(template ? { title: template.title, category: template.category, language: template.language, body: template.body } : EMPTY);
    setError('');
  }, [template]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.title.trim().length < 3) { setError('Donnez un titre d’au moins 3 caractères.'); return; }
    if (draft.body.trim().length < 5) { setError('Écrivez le texte de la réponse.'); return; }
    setBusy(true);
    setError('');
    try {
      const body = { ...draft, title: draft.title.trim() };
      if (template) await templatesApi.update(template.id, body); else await templatesApi.create(body);
      toast.success(template ? 'Réponse modifiée.' : 'Réponse créée.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent size="lg" title={template ? 'Modifier la réponse' : 'Nouvelle réponse'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Titre" required><Input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Catégorie"><Select value={draft.category} onValueChange={v => setDraft(d => ({ ...d, category: v }))} options={CATEGORY_OPTIONS} /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Langue</span>
            <Segmented label="Langue" value={draft.language} onValueChange={v => setDraft(d => ({ ...d, language: v }))}
              options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'Anglais' }]} />
          </div>
        </div>
        <Field label="Texte" required help="Restez général : aucune donnée de membre, aucun montant.">
          <Textarea rows={8} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {template ? <Button type="button" variant="danger-ghost" onClick={() => onDelete(template)}>Supprimer</Button> : <span />}
          <Button type="submit" variant="primary" loading={busy}>Enregistrer</Button>
        </div>
      </form>
    </DialogContent>
  );
}
