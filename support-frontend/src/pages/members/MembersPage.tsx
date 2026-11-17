import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon, UserSearch01Icon } from '@hugeicons/core-free-icons';
import { membersApi } from '../../api/members';
import type { MemberHit } from '../../api/types';
import { usePermissions } from '../../auth/context';
import { ErrorState } from '../../components/display/ErrorState';
import { Button, EmptyState, Input, PageHeader, Panel, ResponsiveList, type ListColumn } from '../../components/ui';
import { formatDate } from '../../lib/format';

const MIN_CHARS = 2;

/** Find a member by exact id, email, phone (any format) or the start of the name. */
export default function MembersPage() {
  const navigate = useNavigate();
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);

  // Debounced: the address bar (and the search) follow the box 400 ms after typing stops.
  useEffect(() => {
    const clean = text.trim();
    if (clean === q) return;
    const t = setTimeout(() => setParams(clean ? { q: clean } : {}, { replace: true }), 400);
    return () => clearTimeout(t);
  }, [text, q, setParams]);

  const enabled = q.length >= MIN_CHARS;
  const search = useQuery({ queryKey: ['members', 'search', q], queryFn: () => membersApi.search(q), enabled, staleTime: 60_000 });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    setParams(clean ? { q: clean } : {}, { replace: true });
  };

  const columns: ListColumn<MemberHit>[] = [
    { key: 'name', header: 'Membre', cell: m => <span className="font-medium text-fg">{m.name}</span> },
    { key: 'country', header: 'Pays', cell: m => m.country ?? '—' },
    { key: 'role', header: 'Rôle', cell: m => m.role ?? '—' },
    { key: 'createdAt', header: 'Inscrit le', cell: m => formatDate(m.createdAt) },
    { key: 'id', header: 'Identifiant', cell: m => <span className="font-mono text-xs text-fg-muted">{m._id}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Membres"
        description={perms.has('members.read.full')
          ? 'Recherchez un membre pour ouvrir sa fiche. Votre rôle voit les coordonnées complètes.'
          : 'Recherchez un membre pour ouvrir sa fiche. L’e-mail et le téléphone sont masqués selon votre rôle.'}
      />
      <Panel>
        <form onSubmit={submit} role="search" className="flex gap-2 border-b border-line p-4">
          <label htmlFor="member-search" className="sr-only">Rechercher un membre</label>
          <Input
            id="member-search"
            type="search"
            autoFocus
            autoComplete="off"
            placeholder="Identifiant, e-mail, téléphone ou début du nom"
            value={text}
            onChange={e => setText(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" aria-label="Rechercher">
            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Rechercher</span>
          </Button>
        </form>
        {!enabled ? (
          <EmptyState icon={UserSearch01Icon} title="Recherchez un membre" description={`Au moins ${MIN_CHARS} caractères. Un numéro peut être tapé dans n’importe quel format.`} />
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={() => search.refetch()} retrying={search.isFetching} />
        ) : (
          <ResponsiveList
            rows={search.data ?? []}
            columns={columns}
            rowKey={m => m._id}
            loading={search.isLoading}
            onRowClick={m => navigate(`/membres/${encodeURIComponent(m._id)}`)}
            empty={<EmptyState icon={UserSearch01Icon} title="Aucun membre trouvé" description="Vérifiez l’orthographe, ou cherchez par e-mail ou par numéro." />}
          />
        )}
      </Panel>
    </>
  );
}
