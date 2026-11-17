import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserGroupIcon } from '@hugeicons/core-free-icons';
import { ProfileStatus, listMembers, type MemberRow } from '../../services/adminSbcLoveApi';
import { Dialog, EmptyState, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn } from '../ui';
import {
  DateText, DetailList, ErrorState, SheetSection, StatusBadge, formatDate, formatNumber,
} from '../moduleKit';
import { PROFILE_STATUS, SEX_LABELS } from './labels';
import { ProfileThumb } from './ProfilesTab';
import { MEMBER_LIMITS, type ApiFilters, type LoveFilters } from './types';

const about = (r: MemberRow) => [r.sex && (SEX_LABELS[r.sex] ?? r.sex), r.ageBracket, r.city].filter(Boolean).join(' · ') || '—';

/**
 * Every SBC Love member with their matches and the conversations those led to.
 * Server-side paginated on purpose: the tallies are computed for the page's
 * members only, so the screen's cost does not grow with the member base.
 */
export function MembersTab({ f, api }: { f: LoveFilters; api: ApiFilters }) {
  const limit = MEMBER_LIMITS.includes(Number(f.values.limit)) ? Number(f.values.limit) : 25;
  const term = f.values.q.trim();
  const [open, setOpen] = useState<MemberRow | null>(null);

  const query = useQuery({
    queryKey: ['sbclove', 'members', f.values.status, term, f.page, limit, api],
    queryFn: () => listMembers({ status: (f.values.status || undefined) as ProfileStatus | undefined, search: term || undefined, page: f.page, limit, ...api }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;

  const identity = (r: MemberRow) => (
    <div className="flex min-w-0 items-center gap-3">
      <ProfileThumb url={r.photoUrl} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{r.displayName}</p>
        <p className="truncate text-xs text-fg-muted">{r.memberEmail ?? r.memberName ?? r.userId}</p>
      </div>
    </div>
  );

  const columns: ListColumn<MemberRow>[] = [
    { key: 'member', header: 'Membre', cell: identity },
    { key: 'about', header: 'Profil', cell: r => <span className="text-fg-muted">{about(r)}</span> },
    { key: 'status', header: 'Statut', cell: r => <StatusBadge status={r.status} map={PROFILE_STATUS} /> },
    { key: 'matches', header: 'Matchs', cell: r => formatNumber(r.matches), numeric: true },
    { key: 'conversations', header: 'Conversations', cell: r => formatNumber(r.conversations), numeric: true },
  ];

  return (
    <div className="space-y-4">

      <Panel className={query.isFetching && !query.isLoading ? 'overflow-hidden opacity-60 transition-opacity' : 'overflow-hidden'}>
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={r => r._id}
          onRowClick={setOpen}
          loading={query.isLoading}
          empty={query.isError
            ? <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            : <EmptyState icon={UserGroupIcon} title={term ? 'Aucun membre ne correspond' : 'Aucun membre'} description={term ? 'Vérifiez l’orthographe ou effacez les filtres.' : 'Les membres apparaissent ici dès qu’ils créent leur profil SBC Love.'} />}
        />
        {pg && <Pagination page={f.page} totalPages={pg.totalPages} total={pg.total} pageSize={limit} onPageChange={f.setPage} />}
      </Panel>

      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
        {open && (
          <SheetContent title={open.displayName} description={open.memberEmail ?? open.memberName ?? open.userId}>
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <ProfileThumb url={open.photoUrl} size="lg" />
                <StatusBadge status={open.status} map={PROFILE_STATUS} />
              </div>
              <SheetSection title="Activité">
                <DetailList items={[
                  ['Matchs', <span className="tabular-nums">{formatNumber(open.matches)}</span>],
                  ['Conversations', <span className="tabular-nums">{formatNumber(open.conversations)}</span>],
                  ['Signalements reçus', <span className="tabular-nums">{formatNumber(open.reportCount)}</span>],
                ]} />
              </SheetSection>
              <SheetSection title="Profil">
                <DetailList items={[
                  ['Nom du membre', open.memberName ?? '—'],
                  ['Sexe', open.sex ? SEX_LABELS[open.sex] ?? open.sex : '—'],
                  ['Âge', open.ageBracket ?? '—'],
                  ['Ville', open.city ?? '—'],
                  ['Photos', <span className="tabular-nums">{open.photoCount}</span>],
                  ['Inscrit à SBC Love', open.createdAt ? <span>{formatDate(open.createdAt)} (<DateText value={open.createdAt} />)</span> : '—'],
                  ['Identifiant du membre', <span className="font-mono text-xs">{open.userId}</span>],
                ]} />
              </SheetSection>
              <p className="text-xs text-fg-muted">Pour valider ou suspendre ce profil, cherchez-le dans l’onglet « Profils ».</p>
            </div>
          </SheetContent>
        )}
      </Dialog>
    </div>
  );
}
