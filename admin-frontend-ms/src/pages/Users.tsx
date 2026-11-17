import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, MoreHorizontalIcon, UserBlock01Icon, UserCheck01Icon, UserGroupIcon, ViewIcon } from '@hugeicons/core-free-icons';
import { blockUser, unblockUser, type AdminUserData, type AdminUserListFilters } from '../services/adminUserApi';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { listMembers, memberSummary } from '../components/members/api';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { ErrorState } from '../components/common/DataStates';
import { formatMoney, formatNumber } from '../components/common/format';
import { Can } from '../components/Can';
import {
  Button, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Metric, PageHeader, Pagination, Panel, PanelHeader,
  ResponsiveList, Select, Skeleton, type ListColumn,
} from '../components/ui';
import { AccountStatusBadge, MemberIdentity, SearchInput, SubscriptionBadges } from '../components/members/shared';
import { PAGE_FILTER_KEYS, countryLabel, useUrlFilters } from '../components/members/filters';

const PAGE_SIZE = 20;
const FILTER_KEYS = ['q', 'status'] as const;
const ALL = 'all';

const STATUS_OPTIONS = [
  { value: ALL, label: 'Tous les statuts' },
  { value: 'active', label: 'Actifs' },
  { value: 'blocked', label: 'Bloqués' },
  { value: 'deleted', label: 'Supprimés' },
];

const pct = (part?: number, total?: number) =>
  part != null && total ? `${Math.round((part / total) * 1000) / 10} % des membres`.replace('.', ',') : undefined;

/** Membres: find a member, see their pack and balance, block or open the profile. */
function Users() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { values, page, active: ownActive, set, setPage, clear } = useUrlFilters(FILTER_KEYS);
  const pageFilters = usePageFilters();
  const range = pageFilters.apiParams;
  const active = ownActive || pageFilters.isFiltered;
  const clearAll = () => clear(PAGE_FILTER_KEYS);
  const [confirmBlock, setConfirmBlock] = useState<AdminUserData | null>(null);

  const filters: AdminUserListFilters = {
    search: values.q || undefined,
    status: (values.status || undefined) as AdminUserListFilters['status'],
  };
  const listKey = ['admin-users', filters, range, page] as const;

  const usersQuery = useQuery({
    queryKey: listKey,
    queryFn: () => listMembers(filters, range, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
  const statsQuery = useQuery({
    queryKey: ['admin-users-summary', range],
    queryFn: () => memberSummary(range),
    placeholderData: keepPreviousData,
  });

  const toggleBlock = useMutation({
    mutationFn: (user: AdminUserData) => (user.blocked ? unblockUser(user._id) : blockUser(user._id)),
    onSuccess: (_, user) => {
      toast.success(user.blocked ? `${user.name} est débloqué.` : `${user.name} est bloqué.`);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'L’action n’a pas abouti. Réessayez.');
    },
  });

  const users = usersQuery.data?.data ?? [];
  const pagination = usersQuery.data?.pagination;
  const stats = statsQuery.data;
  const open = (u: AdminUserData) => navigate(`/userpage/${u._id}`);
  // A page number past the end (filters narrowed, old link): go to the last page.
  const lastPage = pagination?.totalPages ?? 0;
  useEffect(() => { if (lastPage > 0 && page > lastPage) setPage(lastPage); }, [lastPage, page, setPage]);

  const rowActions = (u: AdminUserData, phone = false) => (
    <div className={phone ? 'grid grid-cols-[1fr_auto] gap-2' : 'flex items-center justify-end gap-1'} onClick={e => e.stopPropagation()}>
      <Button variant={phone ? 'outline' : 'ghost'} size={phone ? 'lg' : 'sm'} onClick={() => open(u)}>
        <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />
        Voir la fiche
      </Button>
      {!u.deleted && (
        <Can module="members" write>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size={phone ? 'icon' : 'icon-sm'} className={phone ? 'h-11 w-11' : undefined} aria-label={`Plus d’actions pour ${u.name}`}>
                <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden="true" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {u.blocked ? (
                <MenuItem onSelect={() => setConfirmBlock(u)}>
                  <HugeiconsIcon icon={UserCheck01Icon} size={16} aria-hidden="true" /> Débloquer
                </MenuItem>
              ) : (
                <MenuItem destructive onSelect={() => setConfirmBlock(u)}>
                  <HugeiconsIcon icon={UserBlock01Icon} size={16} aria-hidden="true" /> Bloquer
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </Can>
      )}
    </div>
  );

  const balances = (u: AdminUserData) => (
    <div className="text-right tabular-nums">
      <div>{formatMoney(u.balance ?? 0, 'XAF')}</div>
      {!!u.usdBalance && <div className="text-xs text-fg-muted">{formatMoney(u.usdBalance, 'USD')}</div>}
    </div>
  );

  const columns: ListColumn<AdminUserData>[] = [
    { key: 'member', header: 'Membre', cell: u => <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} /> },
    {
      key: 'contact', header: 'Téléphone', cell: u => (
        <div className="min-w-0">
          <div className="tabular-nums">{u.phoneNumber || '—'}</div>
          <div className="text-xs text-fg-muted">{countryLabel(u.country)}</div>
        </div>
      ),
    },
    { key: 'sub', header: 'Abonnement', cell: u => <SubscriptionBadges types={u.activeSubscriptionTypes} /> },
    { key: 'balance', header: 'Solde', numeric: true, cell: balances },
    { key: 'status', header: 'Statut', cell: u => <AccountStatusBadge user={u} /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, cell: u => rowActions(u), hideOnCard: true, className: 'text-right' },
  ];

  const card = (u: AdminUserData) => (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <MemberIdentity name={u.name} email={u.email} avatar={u.avatar} />
        <AccountStatusBadge user={u} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <SubscriptionBadges types={u.activeSubscriptionTypes} />
        <span className="font-medium tabular-nums text-fg">{formatMoney(u.balance ?? 0, 'XAF')}</span>
      </div>
      <p className="text-xs text-fg-muted">{u.phoneNumber || 'Pas de téléphone'} · {countryLabel(u.country)}</p>
      {rowActions(u, true)}
    </div>
  );

  const total = stats?.totalUsers;
  const statValue = (v?: number) => (statsQuery.isLoading ? <Skeleton className="h-7 w-24" /> : formatNumber(v));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membres"
        description="Retrouvez un membre, voyez son abonnement et son solde, ouvrez sa fiche pour la modifier."
      />

      <PageFilters filters={pageFilters} onReset={clearAll}>
        <SearchInput value={values.q} onChange={v => set('q', v)} placeholder="Nom, e-mail, téléphone ou identifiant" className="sm:flex-1 sm:max-w-md" />
        <Select
          value={values.status || ALL}
          onValueChange={v => set('status', v === ALL ? '' : v)}
          options={STATUS_OPTIONS}
          className="h-11 sm:h-9 sm:w-44"
        />
        {ownActive && !pageFilters.isFiltered && (
          <Button variant="ghost" size="sm" onClick={() => clear()} className="self-start sm:self-auto">
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
            Effacer les filtres
          </Button>
        )}
      </PageFilters>

      <div className={`grid grid-cols-2 gap-3 ${ownActive ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <Metric
          className="col-span-2 lg:col-span-1"
          label={pageFilters.period !== 'all' ? 'Inscrits sur la période' : 'Membres inscrits'}
          value={statValue(total)}
          hint={pageFilters.country ? countryLabel(pageFilters.country) : undefined}
        />
        <Metric label="Abonnés Classique" value={statValue(stats?.activeClassique)} hint={pageFilters.period === 'all' ? pct(stats?.activeClassique, total) : 'abonnements démarrés sur la période'} />
        <Metric label="Abonnés Ciblé" value={statValue(stats?.activeCible)} hint={pageFilters.period === 'all' ? pct(stats?.activeCible, total) : 'abonnements démarrés sur la période'} />
        {ownActive && (
          <Metric
            className="col-span-2 lg:col-span-1"
            label="Résultats de la recherche"
            value={usersQuery.isLoading ? <Skeleton className="h-7 w-24" /> : formatNumber(pagination?.totalCount)}
            hint="membres trouvés"
          />
        )}
      </div>

      <Panel>
        <PanelHeader
          title="Liste des membres"
          description={pagination ? `${formatNumber(pagination.totalCount)} membre${pagination.totalCount > 1 ? 's' : ''}` : undefined}
        />
        <div className={usersQuery.isFetching && !usersQuery.isLoading ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={users}
            columns={columns}
            rowKey={u => u._id}
            onRowClick={open}
            card={card}
            loading={usersQuery.isLoading}
            empty={usersQuery.isError ? (
              <ErrorState
                description={(usersQuery.error as Error)?.message}
                onRetry={() => void usersQuery.refetch()}
                retrying={usersQuery.isFetching}
              />
            ) : (
              <EmptyState
                icon={UserGroupIcon}
                title={active ? 'Aucun membre ne correspond' : 'Aucun membre'}
                description={active ? 'Essayez un autre nom, numéro ou statut.' : undefined}
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

      {statsQuery.isError && (
        <p className="text-xs text-fg-muted">
          Les chiffres du haut n’ont pas pu être chargés. <button className="underline" onClick={() => void statsQuery.refetch()}>Réessayer</button>
        </p>
      )}

      <ConfirmationModal
        isOpen={!!confirmBlock}
        variant={confirmBlock?.blocked ? 'success' : 'danger'}
        title={confirmBlock?.blocked ? `Débloquer ${confirmBlock?.name} ?` : `Bloquer ${confirmBlock?.name} ?`}
        message={confirmBlock?.blocked
          ? 'Le membre pourra de nouveau se connecter.'
          : 'Le membre ne pourra plus se connecter tant qu’il reste bloqué.'}
        confirmText={confirmBlock?.blocked ? 'Débloquer' : 'Bloquer'}
        onConfirm={async () => {
          if (confirmBlock) {
            try { await toggleBlock.mutateAsync(confirmBlock); } catch { /* toast already shown */ }
          }
          setConfirmBlock(null);
        }}
        onCancel={() => setConfirmBlock(null)}
      />
    </div>
  );
}

export default Users;
