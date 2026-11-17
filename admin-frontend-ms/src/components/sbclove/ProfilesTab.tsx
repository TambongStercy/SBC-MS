import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CancelCircleIcon, CheckmarkCircle02Icon, FavouriteIcon, PauseCircleIcon, PlayIcon, ViewIcon } from '@hugeicons/core-free-icons';
import {
  ProfileStatus, listProfiles, setSuspension, validateProfile, type LoveProfile,
} from '../../services/adminSbcLoveApi';
import { Button, EmptyState, MenuItem, Pagination, Panel, ResponsiveList, type ListColumn } from '../ui';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import {
  ConfirmDialog, DateText, ErrorState, RowMenu, StatusBadge, count, type ConfirmOptions,
} from '../moduleKit';
import ProfileReviewSheet from './ProfileReviewModal';
import { PROFILE_STATUS, REJECTION_REASON_NOTE } from './labels';
import { queueScope, type ApiFilters, type LoveFilters } from './types';

const PAGE_SIZE = 15;

export function ProfileThumb({ url, size = 'md' }: { url?: string; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return url
    ? <img src={url} alt="" className={`${cls} shrink-0 rounded-md object-cover`} />
    : <span className={`${cls} grid shrink-0 place-items-center rounded-md bg-surface-3 text-xs text-fg-subtle`} aria-hidden="true">—</span>;
}

const name = (p: LoveProfile) => p.displayName || p.memberName || p.userId;

/**
 * Profiles: opens on the validation queue (new and edited profiles), every
 * status one choice away. « Examiner » opens the photos and text in a sheet,
 * where the decision is taken.
 */
export function ProfilesTab({ f, api }: { f: LoveFilters; api: ApiFilters }) {
  const qc = useQueryClient();
  const canWrite = usePermission('sbclove') === 'write';
  const status = f.values.status || 'pending';
  const term = f.values.q.trim();
  // The validation queue shows every pending profile whatever the period (country only)
  const scope = status === 'pending' ? queueScope(api) : api;
  const [reviewing, setReviewing] = useState<LoveProfile | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

  const query = useQuery({
    queryKey: ['sbclove', 'profiles', status, term, f.page, scope],
    queryFn: () => listProfiles({ status: status === 'all' ? undefined : status as ProfileStatus, search: term || undefined, page: f.page, limit: PAGE_SIZE, ...scope }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const refresh = () => qc.invalidateQueries({ queryKey: ['sbclove'] });

  const decide = useMutation({
    mutationFn: ({ p, approve, reason }: { p: LoveProfile; approve: boolean; reason?: string }) => validateProfile(p._id, approve, reason || undefined),
    onSuccess: (_, v) => {
      toast.success(v.approve ? `Profil de ${name(v.p)} approuvé.` : `Profil de ${name(v.p)} refusé.`);
      setReviewing(null);
      void refresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'L’action a échoué.'),
  });

  const approve = (p: LoveProfile) => setConfirm({
    title: 'Approuver le profil ?',
    description: `Le profil de ${name(p)} devient visible des autres membres SBC Love.`,
    confirmLabel: 'Approuver',
    tone: 'primary',
    onConfirm: () => decide.mutateAsync({ p, approve: true }),
  });

  const reject = (p: LoveProfile) => setConfirm({
    title: 'Refuser le profil ?',
    description: `Le profil de ${name(p)} n’apparaîtra pas aux autres membres.`,
    confirmLabel: 'Refuser',
    reason: { label: 'Motif du refus (facultatif)', placeholder: 'Ex. : contenu inapproprié…' },
    body: <p className="text-xs text-fg-muted">{REJECTION_REASON_NOTE}</p>,
    onConfirm: reason => decide.mutateAsync({ p, approve: false, reason }),
  });

  const suspend = (p: LoveProfile) => {
    const isSuspended = p.status === ProfileStatus.SUSPENDED;
    setConfirm({
      title: isSuspended ? 'Réintégrer le profil ?' : 'Suspendre le profil ?',
      description: isSuspended
        ? `Le profil de ${name(p)} redevient visible des autres membres.`
        : `Le profil de ${name(p)} est retiré de SBC Love jusqu’à sa réintégration.`,
      confirmLabel: isSuspended ? 'Réintégrer' : 'Suspendre',
      tone: isSuspended ? 'primary' : 'danger',
      onConfirm: async () => {
        await setSuspension(p._id, !isSuspended);
        toast.success(isSuspended ? 'Profil réintégré.' : 'Profil suspendu.');
        void refresh();
      },
    });
  };

  const photoReq = (p: LoveProfile) => (!p.meetsPhotoRequirement ? `${p.minPhotos} photos minimum` : undefined);

  const menu = (p: LoveProfile) => (
    <Can module="sbclove" write>
      <RowMenu>
        {(p.status === ProfileStatus.PENDING || p.status === ProfileStatus.REJECTED) && (
          <MenuItem disabled={!p.meetsPhotoRequirement} onSelect={() => approve(p)}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />
            {p.meetsPhotoRequirement ? 'Approuver' : `Approuver (${photoReq(p)})`}
          </MenuItem>
        )}
        {p.status === ProfileStatus.PENDING && (
          <MenuItem destructive onSelect={() => reject(p)}>
            <HugeiconsIcon icon={CancelCircleIcon} size={16} aria-hidden="true" />
            Refuser
          </MenuItem>
        )}
        {p.status === ProfileStatus.APPROVED && (
          <MenuItem destructive onSelect={() => suspend(p)}>
            <HugeiconsIcon icon={PauseCircleIcon} size={16} aria-hidden="true" />
            Suspendre
          </MenuItem>
        )}
        {p.status === ProfileStatus.SUSPENDED && (
          <MenuItem onSelect={() => suspend(p)}>
            <HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />
            Réintégrer
          </MenuItem>
        )}
      </RowMenu>
    </Can>
  );

  const actions = (p: LoveProfile, phone = false) => (
    <div className={phone ? 'flex items-center gap-2' : 'flex items-center justify-end gap-1'} onClick={e => e.stopPropagation()}>
      <Button variant={p.status === ProfileStatus.PENDING ? 'soft' : 'ghost'} size="md" className={phone ? 'h-11 flex-1' : ''} onClick={() => setReviewing(p)}>
        <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />
        Examiner
      </Button>
      {menu(p)}
    </div>
  );

  const photos = (p: LoveProfile) => (
    <span className={p.meetsPhotoRequirement ? 'text-fg' : 'font-medium text-[color-mix(in_oklch,var(--warning),var(--fg)_35%)]'}>
      {p.photoCount}/{p.minPhotos}
    </span>
  );

  const identity = (p: LoveProfile) => (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileThumb url={p.photos[0]?.url} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{p.displayName || p.memberName || <span className="text-fg-subtle">Sans pseudo</span>}</p>
        {p.memberName && p.displayName && <p className="truncate text-xs text-fg-muted">{p.memberName}</p>}
      </div>
    </div>
  );

  const columns: ListColumn<LoveProfile>[] = [
    { key: 'member', header: 'Membre', cell: identity },
    { key: 'photos', header: 'Photos', cell: photos, numeric: true },
    { key: 'status', header: 'Statut', cell: p => <StatusBadge status={p.status} map={PROFILE_STATUS} /> },
    { key: 'reports', header: 'Signalements', cell: p => p.moderation.reportCount, numeric: true },
    { key: 'created', header: 'Créé', cell: p => <DateText value={p.createdAt} className="text-fg-muted" /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, cell: p => actions(p), hideOnCard: true },
  ];

  const card = (p: LoveProfile) => (
    <div className="space-y-3">
      {identity(p)}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
        <StatusBadge status={p.status} map={PROFILE_STATUS} />
        <span>Photos {photos(p)}</span>
        {p.moderation.reportCount > 0 && <span>{count(p.moderation.reportCount, 'signalement')}</span>}
        <DateText value={p.createdAt} />
      </div>
      {actions(p, true)}
    </div>
  );

  const emptyText = term
    ? (status === 'pending' ? 'Aucun profil à valider ne correspond. Vérifiez l’orthographe, ou cherchez dans « Tous les statuts ».' : 'Aucun profil ne correspond.')
    : status === 'pending' ? 'Les nouveaux profils et les profils modifiés arrivent ici.' : 'Aucun profil avec ce statut.';

  return (
    <div className="space-y-4">

      <Panel className={query.isFetching && !query.isLoading ? 'overflow-hidden opacity-60 transition-opacity' : 'overflow-hidden'}>
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={p => p._id}
          card={card}
          onRowClick={setReviewing}
          loading={query.isLoading}
          empty={query.isError
            ? <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            : <EmptyState icon={FavouriteIcon} title={status === 'pending' && !term ? 'Aucun profil à valider' : 'Aucun profil'} description={emptyText} />}
        />
        {pg && <Pagination page={f.page} totalPages={pg.totalPages} total={pg.total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />}
      </Panel>

      <ProfileReviewSheet
        profile={reviewing}
        isBusy={decide.isPending}
        onClose={() => setReviewing(null)}
        onApprove={p => decide.mutate({ p, approve: true })}
        onReject={(p, reason) => decide.mutate({ p, approve: false, reason })}
      />
      <ConfirmDialog options={canWrite ? confirm : null} onClose={() => setConfirm(null)} />
    </div>
  );
}
