import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon, Delete02Icon, MoreHorizontalIcon, RestoreBinIcon, UserBlock01Icon, UserCheck01Icon, UserIcon,
} from '@hugeicons/core-free-icons';
import UserCard from '../components/userCard';
import UserProductsTable from '../components/usersProductsTable';
import {
  getUserDetails, adminUpdateUserSubscription, adminUpdateUserPartner, PartnerPack, blockUser, unblockUser, deleteUser, restoreUser,
  type AdminUserData, type SubscriptionType,
} from '../services/adminUserApi';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatDate, formatMoney } from '../components/common/format';
import { Can } from '../components/Can';
import {
  Avatar, Button, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, Metric, PageHeader, Skeleton,
} from '../components/ui';
import { AccountStatusBadge, RoleBadge, SubscriptionBadges } from '../components/members/shared';
import { countryLabel } from '../components/members/filters';
import { getAvatarUrl } from '../api/apiClient';

type AccountAction = 'block' | 'unblock' | 'delete' | 'restore';

const ACTION_TEXT: Record<AccountAction, { title: (n: string) => string; message: string; confirm: string; variant: 'danger' | 'success' | 'primary'; done: string }> = {
  block: { title: n => `Bloquer ${n} ?`, message: 'Le membre ne pourra plus se connecter tant qu’il reste bloqué.', confirm: 'Bloquer', variant: 'danger', done: 'Membre bloqué.' },
  unblock: { title: n => `Débloquer ${n} ?`, message: 'Le membre retrouvera l’accès à son compte.', confirm: 'Débloquer', variant: 'success', done: 'Membre débloqué.' },
  delete: { title: n => `Supprimer ${n} ?`, message: 'Le compte est désactivé et masqué. La suppression est réversible : « Restaurer » le réactive.', confirm: 'Supprimer', variant: 'danger', done: 'Compte supprimé.' },
  restore: { title: n => `Restaurer ${n} ?`, message: 'Son compte sera réactivé.', confirm: 'Restaurer', variant: 'primary', done: 'Compte restauré.' },
};

/** Fiche d’un membre: who they are, their balance and pack, and what can be changed. */
function UsersPage() {
  const { userId } = useParams<{ userId: string }>();
  const queryClient = useQueryClient();
  const key = ['admin-user', userId] as const;
  const userQuery = useQuery({
    queryKey: key,
    queryFn: () => getUserDetails(userId!),
    enabled: !!userId,
  });
  const [action, setAction] = useState<AccountAction | null>(null);
  const user = userQuery.data;

  const patch = (changes: Partial<AdminUserData>) => {
    queryClient.setQueryData<AdminUserData>(key, prev => (prev ? { ...prev, ...changes } : prev));
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const handleSubscriptionChange = async (targetUserId: string, newType: SubscriptionType.CLASSIQUE | SubscriptionType.CIBLE | 'NONE') => {
    const id = toast.loading('Mise à jour de l’abonnement…');
    try {
      await adminUpdateUserSubscription(targetUserId, newType);
      toast.success('Abonnement mis à jour.', { id });
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      toast.error(`L’abonnement n’a pas été changé : ${(error as Error).message}`, { id });
      throw error;
    }
  };

  const handlePartnerPackChange = async (targetUserId: string, newPack: 'silver' | 'gold' | 'none') => {
    const id = toast.loading('Mise à jour du statut partenaire…');
    try {
      await adminUpdateUserPartner(targetUserId, newPack);
      toast.success('Statut partenaire mis à jour.', { id });
      patch({ partnerPack: newPack === 'none' ? undefined : newPack === 'silver' ? PartnerPack.SILVER : PartnerPack.GOLD });
    } catch (error) {
      toast.error(`Le statut partenaire n’a pas été changé : ${(error as Error).message}`, { id });
      throw error;
    }
  };

  const runAction = async (a: AccountAction) => {
    if (!user) return;
    try {
      if (a === 'block') await blockUser(user._id);
      else if (a === 'unblock') await unblockUser(user._id);
      else if (a === 'delete') await deleteUser(user._id);
      else await restoreUser(user._id);
      patch(a === 'block' ? { blocked: true } : a === 'unblock' ? { blocked: false } : a === 'delete' ? { deleted: true } : { deleted: false });
      toast.success(ACTION_TEXT[a].done);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || (err as Error).message || 'L’action n’a pas abouti.');
    } finally {
      setAction(null);
    }
  };

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 h-11 sm:h-8">
      <Link to="/users"><HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Membres</Link>
    </Button>
  );

  if (userQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        {back}
        <div className="flex items-center gap-4"><Skeleton className="h-14 w-14 rounded-full" /><div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-40" /></div></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        {back}
        {userQuery.isError ? (
          <ErrorState
            title="Ce membre n’a pas pu être chargé"
            description={(userQuery.error as Error)?.message || 'Vérifiez l’identifiant ou revenez à la liste.'}
            onRetry={() => void userQuery.refetch()}
            retrying={userQuery.isFetching}
          />
        ) : (
          <EmptyState icon={UserIcon} title="Membre introuvable" description="L’identifiant dans l’adresse ne correspond à aucun membre." />
        )}
      </div>
    );
  }

  const primary: AccountAction | null = user.deleted ? 'restore' : user.blocked ? 'unblock' : 'block';

  return (
    <div className="space-y-6">
      <div>
        {back}
        <PageHeader
          className="mb-0"
          title={(
            <span className="flex min-w-0 items-center gap-3">
              <Avatar src={user.avatar ? getAvatarUrl(user.avatar) : null} name={user.name || user.email} size="lg" />
              <span className="min-w-0 break-words">{user.name || 'Sans nom'}</span>
            </span>
          )}
          description={(
            <span className="break-all">{user.email}{user.phoneNumber ? ` · ${user.phoneNumber}` : ''} · {countryLabel(user.country)}</span>
          )}
          actions={(
            <Can module="members" write>
              <Button
                variant={primary === 'block' ? 'outline' : 'primary'}
                size="lg"
                className="flex-1 sm:flex-none"
                onClick={() => setAction(primary)}
              >
                <HugeiconsIcon icon={primary === 'block' ? UserBlock01Icon : primary === 'unblock' ? UserCheck01Icon : RestoreBinIcon} size={18} aria-hidden="true" />
                {ACTION_TEXT[primary].confirm}
              </Button>
              {!user.deleted && (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Plus d’actions">
                      <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem destructive onSelect={() => setAction('delete')}>
                      <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer le compte
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </Can>
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge user={user} />
            <SubscriptionBadges types={user.activeSubscriptionTypes} />
            {user.partnerPack && <span className="text-xs text-fg-muted">Partenaire {user.partnerPack === PartnerPack.GOLD ? 'Gold' : 'Silver'}</span>}
            {user.role && user.role !== 'user' && <RoleBadge role={user.role} />}
          </div>
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Solde" value={formatMoney(user.balance ?? 0, 'XAF')} hint="retirable" />
        <Metric label="Solde en dollars" value={formatMoney(user.usdBalance ?? 0, 'USD')} />
        <Metric label="Membre depuis" value={<span className="text-lg">{formatDate(user.createdAt)}</span>} />
        <Metric
          label="Dernière connexion"
          value={<span className="text-lg">{user.lastLogin ? <RelativeTime value={user.lastLogin} /> : '—'}</span>}
          hint={user.isVerified ? 'Compte vérifié' : 'Compte non vérifié'}
        />
      </div>

      <UserCard
        key={user._id}
        user={user}
        onSaved={patch}
        onSubscriptionChange={handleSubscriptionChange}
        onPartnerPackChange={handlePartnerPackChange}
      />

      {/* Kept from the old page: the product list is not filled by the API here (always empty). */}
      <details className="group rounded-panel border border-line bg-surface">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-fg">
          Produits et services du membre
          <span className="ml-2 text-xs font-normal text-fg-muted">(voir la Boutique pour la gestion des produits)</span>
        </summary>
        <div className="border-t border-line px-2 pb-2 sm:px-4">
          <UserProductsTable
            data={{
              id: user._id,
              name: user.name,
              email: user.email,
              phone: user.phoneNumber?.toString() || '—',
              town: user.city || user.region || '—',
              product: [],
            }}
          />
        </div>
      </details>

      <ConfirmationModal
        isOpen={!!action}
        variant={action ? ACTION_TEXT[action].variant : 'danger'}
        title={action ? ACTION_TEXT[action].title(user.name) : ''}
        message={action ? ACTION_TEXT[action].message : ''}
        confirmText={action ? ACTION_TEXT[action].confirm : 'Confirmer'}
        onConfirm={() => (action ? runAction(action) : undefined)}
        onCancel={() => setAction(null)}
      />
    </div>
  );
}

export default UsersPage;
