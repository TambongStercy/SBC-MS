import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Search01Icon, UserSearch01Icon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import { listUsers, type AdminUserData } from '../../services/adminUserApi';
import { ROLE_LABEL } from '../../lib/roles';
import { Avatar, Badge, Dialog, EmptyState, Input, SheetContent, Skeleton } from '../ui';
import { cn } from '../../lib/cn';

/** Typing pause before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Step one of "Ajouter un membre de l'équipe": find the member (name, email
 * or phone, same search as the members list), then pick them to set rights.
 */
export function AddMemberSheet({ open, onOpenChange, onPick, teamIds }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (member: AdminUserData) => void;
  /** Accounts already in the team (shown as such). */
  teamIds: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 300);
  const enabled = open && search.length >= 2;

  const results = useQuery({
    queryKey: ['admin-team-member-search', search],
    queryFn: () => listUsers({ search }, { page: 1, limit: 10 }),
    enabled,
    staleTime: 30 * 1000,
  });

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const members = results.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent
        width="lg"
        title="Ajouter un membre de l’équipe"
        description="Cherchez le compte du membre, puis choisissez ce qu’il pourra faire dans l’admin."
      >
        <div className="space-y-4">
          <div className="relative">
            <HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              type="search"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Nom, e-mail ou téléphone"
              aria-label="Rechercher un membre"
              className="h-11 pl-10 text-base sm:text-sm"
            />
          </div>

          {!enabled ? (
            <EmptyState icon={UserSearch01Icon} title="Tapez au moins 2 caractères" description="Le nom, l’adresse e-mail ou le numéro du membre." />
          ) : results.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : results.isError ? (
            <EmptyState icon={UserSearch01Icon} title="La recherche n’a pas abouti" description="Vérifiez la connexion, puis réessayez." />
          ) : members.length === 0 ? (
            <EmptyState icon={UserSearch01Icon} title="Aucun membre trouvé" description={`Rien pour « ${search} ».`} />
          ) : (
            <ul className="divide-y divide-line rounded-panel border border-line" aria-label="Membres trouvés">
              {members.map(member => {
                const role = member.role ?? 'user';
                const superAdmin = role === 'admin';
                const inTeam = teamIds.has(member._id);
                return (
                  <li key={member._id}>
                    <button
                      type="button"
                      disabled={superAdmin}
                      onClick={() => onPick(member)}
                      className={cn(
                        'flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                        superAdmin ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-2 active:bg-surface-2',
                      )}
                    >
                      <Avatar src={getAvatarUrl(member.avatar)} name={member.name || member.email || '?'} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{member.name || 'Sans nom'}</span>
                        <span className="block truncate text-xs text-fg-muted">{member.email}</span>
                      </span>
                      {superAdmin ? (
                        <Badge tone="primary">Super admin</Badge>
                      ) : inTeam ? (
                        <Badge tone="info">Déjà dans l’équipe</Badge>
                      ) : role !== 'user' ? (
                        <Badge tone="neutral">{ROLE_LABEL[role] ?? role}</Badge>
                      ) : null}
                      {member.blocked && <Badge tone="danger">Bloqué</Badge>}
                      {!superAdmin && <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" className="shrink-0 text-fg-subtle" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
