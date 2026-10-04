import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getStats, listMembers, setSuspension, ProfileStatus, type MemberRow } from '../../../services/adminSbcLoveApi';
import { Button, ButtonLink, ConfirmSheet, DataList, EmptyState, KeyValue, MemberLink, Pagination, Select, Sheet, Stat, StatusBadge, notify, type Column } from '../../../ui';
import { formatDate, formatNumber } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { PROFILE_STATUS, sexLabel } from './shared';

const PAGE = 20;
const SUSPEND = ['Signalements répétés', 'Demande d’argent', 'Faux profil', 'Comportement insultant'];

function Thumb({ m, size = 44 }: { m: MemberRow; size?: number }) {
    return m.photoUrl
        ? <img src={m.photoUrl} alt="" style={{ width: size, height: size }} className="rounded-tile object-cover bg-surface-2 shrink-0" />
        : <span style={{ width: size, height: size }} className="rounded-tile bg-surface-2 shrink-0" />;
}

function MemberSheet({ m, onClose }: { m: MemberRow; onClose: () => void }) {
    const qc = useQueryClient();
    const [action, setAction] = useState<'suspend' | 'reinstate' | null>(null);
    const refresh = () => qc.invalidateQueries({ queryKey: ['sbclove'] });
    return (
        <Sheet open onClose={onClose} title={m.displayName || m.memberName || 'Profil'}
            footer={m.status === ProfileStatus.APPROVED ? <Button variant="danger-soft" full onClick={() => setAction('suspend')}>Suspendre…</Button>
                : m.status === ProfileStatus.SUSPENDED ? <Button full onClick={() => setAction('reinstate')}>Réintégrer</Button>
                    : m.status === ProfileStatus.PENDING ? <ButtonLink to="/modules/sbc-love" full>Aller à la validation</ButtonLink> : undefined}>
            <div className="space-y-4">
                {m.photoUrl && <img src={m.photoUrl} alt="" className="w-full max-h-[45vh] object-cover rounded-tile bg-surface-2" />}
                <StatusBadge status={m.status} labels={PROFILE_STATUS} />
                <MemberLink id={m.userId} name={m.memberName ?? m.displayName} sub={m.memberEmail} />
                <KeyValue items={[
                    ['Sexe', sexLabel(m.sex)],
                    ['Âge', m.ageBracket ?? '—'],
                    ['Ville', m.city || '—'],
                    ['Photos', formatNumber(m.photoCount)],
                    ['Matchs', formatNumber(m.matches)],
                    ['Conversations', formatNumber(m.conversations)],
                    ['Signalements', m.reportCount ? <span className="text-danger">{m.reportCount}</span> : '0'],
                    m.createdAt ? ['Créé le', formatDate(m.createdAt)] : null,
                ]} />
                {m.status === ProfileStatus.REJECTED && <p className="text-sm text-ink-2">Refusé : le membre doit le modifier pour qu’il revienne en validation.</p>}
            </div>
            <ConfirmSheet open={action === 'suspend'} onClose={() => setAction(null)} tone="danger" title={`Suspendre ${m.displayName || 'ce profil'} ?`}
                message={<p>Le profil n’est plus proposé aux autres membres. Le membre voit « Suspendu » et l’invitation à contacter le support.</p>}
                reason={{ label: 'Motif (pour l’équipe)', suggestions: SUSPEND, minLength: 5 }}
                confirmLabel="Suspendre"
                onConfirm={async (reason) => { await setSuspension(m._id, true, reason); notify.success('Profil suspendu.'); refresh(); onClose(); }} />
            <ConfirmSheet open={action === 'reinstate'} onClose={() => setAction(null)} tone="success" title={`Réintégrer ${m.displayName || 'ce profil'} ?`}
                message={<p>Le profil est de nouveau publié et son compteur de signalements repart de zéro.</p>}
                confirmLabel="Réintégrer"
                onConfirm={async () => { await setSuspension(m._id, false); notify.success('Profil réintégré.'); refresh(); onClose(); }} />
        </Sheet>
    );
}

/** Every SBC Love profile with its matches and conversations; suspend or reinstate one. */
export function ProfilesTab() {
    const [status, setStatus] = useParamState('statut', '');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<MemberRow | null>(null);
    const stats = useQuery({ queryKey: ['sbclove', 'stats'], queryFn: getStats });
    const q = useQuery({
        queryKey: ['sbclove', 'members', status, page],
        queryFn: () => listMembers({ status: (status || undefined) as ProfileStatus | undefined, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    const s = stats.data;
    const cols: Column<MemberRow>[] = [
        { key: 'n', header: 'Profil', cell: m => <span className="flex items-center gap-3 min-w-0"><Thumb m={m} />
            <span className="min-w-0"><span className="block font-semibold truncate">{m.displayName || '—'}</span><span className="block text-xs text-ink-2 truncate">{m.memberName ?? ''}</span></span></span> },
        { key: 'i', header: 'Sexe, âge, ville', cell: m => <span className="text-ink-2">{[sexLabel(m.sex), m.ageBracket, m.city].filter(x => x && x !== '—').join(' · ') || '—'}</span> },
        { key: 's', header: 'Statut', cell: m => <StatusBadge status={m.status} labels={PROFILE_STATUS} /> },
        { key: 'm', header: 'Matchs', align: 'right', cell: m => formatNumber(m.matches) },
        { key: 'c', header: 'Conversations', align: 'right', cell: m => formatNumber(m.conversations) },
        { key: 'r', header: 'Signalements', align: 'right', cell: m => (m.reportCount ? <span className="text-danger font-semibold">{m.reportCount}</span> : '0') },
    ];
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Stat label="Profils publiés" value={formatNumber(s?.profiles.approved)} loading={stats.isLoading} hint={s ? `${formatNumber(s.profiles.total)} au total` : undefined} />
                <Stat label="Matchs" value={formatNumber(s?.matches.total)} loading={stats.isLoading} hint={s ? `${formatNumber(s.matches.conversations)} conversations` : undefined} />
                <Stat label="Intérêts envoyés" value={formatNumber(s?.interests.total)} loading={stats.isLoading} />
                <Stat label="Suspendus" value={formatNumber(s?.profiles.suspended)} loading={stats.isLoading} hint={s ? `${formatNumber(s.profiles.rejected)} refusés` : undefined} />
            </div>
            <div className="sm:w-64"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                <option value="">Tous</option>
                {Object.entries(PROFILE_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
            </Select></div>
            <DataList rows={q.data?.data} columns={cols} rowKey={m => m._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucun profil" />}
                card={m => (
                    <span className="flex items-center gap-3">
                        <Thumb m={m} />
                        <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{m.displayName || m.memberName || '—'}</span>
                            <span className="block text-xs text-ink-2 truncate">{formatNumber(m.matches)} matchs · {formatNumber(m.conversations)} conversations{m.reportCount ? ` · ${m.reportCount} signalement${m.reportCount > 1 ? 's' : ''}` : ''}</span></span>
                        <StatusBadge status={m.status} labels={PROFILE_STATUS} />
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.pagination.totalPages)} total={q.data.pagination.total} onChange={setPage} />}
            {open && <MemberSheet m={open} onClose={() => setOpen(null)} />}
        </div>
    );
}
