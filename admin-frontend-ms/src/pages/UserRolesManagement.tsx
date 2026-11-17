/**
 * Rôles: the role of every account (member, tester, older admin roles, super
 * admin). Changing a role is super-admin only (module `staff`); per-module
 * rights of staff accounts are set on the Équipe page.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon, InformationCircleIcon, UserSettings01Icon } from '@hugeicons/core-free-icons';
import { updateUserRole, type AdminUserData, type AdminUserListFilters } from '../services/adminUserApi';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { listMembers } from '../components/members/api';
import { ROLE_LABEL } from '../lib/roles';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { ErrorState } from '../components/common/DataStates';
import { formatNumber } from '../components/common/format';
import { Can } from '../components/Can';
import {
  Button, EmptyState, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Select, type ListColumn,
} from '../components/ui';
import { AccountStatusBadge, MemberIdentity, RoleBadge, SearchInput } from '../components/members/shared';
import { PAGE_FILTER_KEYS, countryLabel, useUrlFilters } from '../components/members/filters';

const PAGE_SIZE = 20;
const FILTER_KEYS = ['q', 'role', 'status'] as const;
const ALL = 'all';
/** Roles this page can give (staff = Équipe page). */
const ROLE_CHOICES = ['user', 'tester', 'withdrawal_admin', 'admin'];
const ROLE_FILTERS = ['user', 'tester', 'staff', 'withdrawal_admin', 'moderator', 'admin'];
const ELEVATED = new Set(['admin', 'withdrawal_admin']);

const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

const UserRolesManagement = () => {
  const queryClient = useQueryClient();
  const { values, page, active: ownActive, set, setPage, clear } = useUrlFilters(FILTER_KEYS);
  // Country only: a period (sign-up date) says nothing about who holds which role.
  const pageFilters = usePageFilters();
  const range = pageFilters.country ? { country: pageFilters.country } : {};
  const active = ownActive || !!pageFilters.country;
  const clearAll = () => clear(PAGE_FILTER_KEYS);
  const [pending, setPending] = useState<{ user: AdminUserData; role: string } | null>(null);

  const filters: AdminUserListFilters = {
    search: values.q || undefined,
    role: values.role || undefined,
    status: (values.status || undefined) as AdminUserListFilters['status'],
  };
  const query = useQuery({
    queryKey: ['admin-users', 'roles', filters, range, page],
    queryFn: () => listMembers(filters, range, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const change = useMutation({
    mutationFn: ({ user, role }: { user: AdminUserData; role: string }) => updateUserRole(user._id, role),
    onSuccess: (_, { user, role }) => {
      toast.success(`${user.name} a maintenant le rôle ${roleLabel(role)}.`);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Le rôle n’a pas été changé.'),
  });

  const users = query.data?.data ?? [];
  const pagination = query.data?.pagination;
  // A page number past the end (filters narrowed, old link): go to the last page.
  const lastPage = pagination?.totalPages ?? 0;
  useEffect(() => { if (lastPage > 0 && page > lastPage) setPage(lastPage); }, [lastPage, page, setPage]);

  const roleControl = (u: AdminUserData, phone = false) => {
    const current = u.role || 'user';
    if (current === 'staff' || current === 'moderator') {
      return <Link to="/equipe" className="text-sm text-primary underline-offset-4 hover:underline">Gérer dans Équipe</Link>;
    }
    return (
      <Can module="staff" write fallback={<span className="text-xs text-fg-subtle">Lecture seule</span>}>
        <div onClick={e => e.stopPropagation()}>
          <Select
            value={current}
            onValueChange={v => { if (v !== current) setPending({ user: u, role: v }); }}
            options={(ROLE_CHOICES.includes(current) ? ROLE_CHOICES : [current, ...ROLE_CHOICES]).map(r => ({ value: r, label: roleLabel(r) }))}
            className={phone ? 'h-11' : 'h-9 w-48'}
          />
        </div>
      </Can>
    );
  };

  const columns: ListColumn<AdminUserData>[] = [
    { key: 'who', header: 'Compte', cell: u => <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} /> },
    {
      key: 'contact', header: 'Téléphone', cell: u => (
        <div><div className="tabular-nums">{u.phoneNumber || '—'}</div><div className="text-xs text-fg-muted">{countryLabel(u.country)}</div></div>
      ),
    },
    { key: 'role', header: 'Rôle actuel', cell: u => <RoleBadge role={u.role} /> },
    { key: 'status', header: 'Statut', cell: u => <AccountStatusBadge user={u} /> },
    { key: 'change', header: 'Changer le rôle', cell: u => roleControl(u), hideOnCard: true },
  ];

  const card = (u: AdminUserData) => (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} />
        <AccountStatusBadge user={u} />
      </div>
      <div className="flex items-center gap-2"><RoleBadge role={u.role} /><span className="text-xs text-fg-muted">{u.phoneNumber || ''}</span></div>
      <div className="space-y-1.5">
        <p className="text-xs text-fg-muted">Changer le rôle</p>
        {roleControl(u, true)}
      </div>
    </div>
  );

  const elevating = !!pending && ELEVATED.has(pending.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rôles"
        description="Le rôle de chaque compte : membre, testeur, super admin. Seul le super admin peut le changer."
        actions={(
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link to="/equipe">Droits de l’équipe</Link>
          </Button>
        )}
      />

      <PageFilters filters={pageFilters} hidePeriod onReset={clearAll}>
        <SearchInput value={values.q} onChange={v => set('q', v)} placeholder="Nom, e-mail ou téléphone" className="sm:flex-1 sm:max-w-md" />
        <Select
          value={values.role || ALL}
          onValueChange={v => set('role', v === ALL ? '' : v)}
          options={[{ value: ALL, label: 'Tous les rôles' }, ...ROLE_FILTERS.map(r => ({ value: r, label: roleLabel(r) }))]}
          className="h-11 sm:h-9 sm:w-52"
        />
        <Select
          value={values.status || ALL}
          onValueChange={v => set('status', v === ALL ? '' : v)}
          options={[{ value: ALL, label: 'Tous les statuts' }, { value: 'active', label: 'Actifs' }, { value: 'blocked', label: 'Bloqués' }]}
          className="h-11 sm:h-9 sm:w-44"
        />
        {ownActive && !pageFilters.isFiltered && (
          <Button variant="ghost" size="sm" onClick={() => clear()} className="self-start sm:self-auto">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
            Effacer les filtres
          </Button>
        )}
      </PageFilters>

      <Panel>
        <PanelHeader
          title="Comptes"
          description={pagination ? `${formatNumber(pagination.totalCount)} compte${pagination.totalCount > 1 ? 's' : ''}` : undefined}
        />
        <div className={query.isFetching && !query.isLoading ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={users}
            columns={columns}
            rowKey={u => u._id}
            card={card}
            loading={query.isLoading}
            empty={query.isError ? (
              <ErrorState description={(query.error as Error)?.message} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            ) : (
              <EmptyState
                icon={UserSettings01Icon}
                title="Aucun compte ne correspond"
                description="Essayez un autre nom ou un autre rôle."
                action={active ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
              />
            )}
          />
        </div>
        {pagination && (
          <Pagination
            page={pagination.currentPage || page}
            totalPages={pagination.totalPages}
            total={pagination.totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </Panel>

      <Panel className="border-info/30 bg-info-soft/40">
        <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
          <HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <p className="text-sm text-fg-muted">
            Pour donner à quelqu’un un accès limité (lecture ou modification, espace par espace), utilisez plutôt
            {' '}<Link to="/equipe" className="font-medium text-primary underline-offset-4 hover:underline">Équipe</Link>.
            {' '}Le rôle Super admin donne tous les droits.
          </p>
        </div>
      </Panel>

      <ConfirmationModal
        isOpen={!!pending}
        variant={elevating ? 'danger' : 'primary'}
        title="Changer le rôle ?"
        message={pending && (
          <div className="space-y-2">
            <p>{pending.user.name} passera de <b className="text-fg">{roleLabel(pending.user.role || 'user')}</b> à <b className="text-fg">{roleLabel(pending.role)}</b>.</p>
            {elevating && (
              <p className="flex items-start gap-2 text-danger">
                <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                Ce rôle donne un accès à l’administration.
              </p>
            )}
          </div>
        )}
        confirmText="Changer le rôle"
        onConfirm={async () => {
          if (pending) { try { await change.mutateAsync(pending); } catch { /* toast shown */ } }
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

export default UserRolesManagement;
