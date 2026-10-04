import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { listReports, reviewReport, setSuspension, ProfileStatus, ReportStatus, type Report } from '../../../services/adminSbcLoveApi';
import { Badge, Button, Card, ConfirmSheet, EmptyState, ErrorState, ListSkeleton, MemberLink, Pagination, Select, StatusBadge, notify } from '../../../ui';
import { timeAgo } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { PROFILE_STATUS, REPORT_STATUS } from './shared';

const PAGE = 20;

function ReportCard({ r }: { r: Report }) {
    const qc = useQueryClient();
    const [suspend, setSuspend] = useState(false);
    const [busy, setBusy] = useState<ReportStatus | null>(null);
    const refresh = () => { qc.invalidateQueries({ queryKey: ['sbclove'] }); qc.invalidateQueries({ queryKey: ['queue', 'love'] }); };
    const close = async (status: ReportStatus.REVIEWED | ReportStatus.DISMISSED) => {
        setBusy(status);
        try { await reviewReport(r._id, status); notify.success(status === ReportStatus.REVIEWED ? 'Signalement traité.' : 'Signalement classé sans suite.'); refresh(); }
        catch (e) { notify.error(errorMessage(e)); }
        finally { setBusy(null); }
    };
    const reported = r.reported;
    const canSuspend = reported?.profileId && reported.profileStatus !== ProfileStatus.SUSPENDED;
    const name = reported?.displayName ?? 'ce profil';

    return (
        <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs text-ink-3">Signalé {timeAgo(r.createdAt)}</p>
                    <MemberLink id={r.reportedUserId} name={reported?.displayName ?? 'Profil introuvable'} sub={reported?.email} />
                </div>
                <StatusBadge status={r.status} labels={REPORT_STATUS} />
            </div>
            <p className="text-sm text-ink bg-surface-2 rounded-tile px-3 py-2 whitespace-pre-line break-words">{r.reason}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {reported?.profileStatus && <StatusBadge status={reported.profileStatus} labels={PROFILE_STATUS} />}
                {reported && reported.reportCount > 1 && <Badge tone="danger">{reported.reportCount} signalements au total</Badge>}
                <span className="text-ink-3">par {r.reporter?.displayName ?? 'un membre'}</span>
            </div>
            {r.status === ReportStatus.OPEN && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {canSuspend && <Button variant="danger-soft" className="col-span-2 sm:col-span-1" onClick={() => setSuspend(true)}>Suspendre le profil…</Button>}
                    <Button variant="secondary" loading={busy === ReportStatus.REVIEWED} disabled={!!busy} onClick={() => close(ReportStatus.REVIEWED)}>Traité</Button>
                    <Button variant="ghost" loading={busy === ReportStatus.DISMISSED} disabled={!!busy} onClick={() => close(ReportStatus.DISMISSED)}>Sans suite</Button>
                </div>
            )}
            <ConfirmSheet open={suspend} onClose={() => setSuspend(false)} tone="danger" title={`Suspendre ${name} ?`}
                message={<p>Le profil n’est plus proposé aux autres membres et le membre voit « Suspendu ». Le signalement est marqué traité.</p>}
                reason={{ label: 'Motif (pour l’équipe)', suggestions: ['Signalements répétés', 'Demande d’argent', 'Faux profil', 'Comportement insultant'], minLength: 5 }}
                confirmLabel="Suspendre"
                onConfirm={async (reason) => {
                    await setSuspension(reported!.profileId!, true, reason);
                    await reviewReport(r._id, ReportStatus.REVIEWED);
                    notify.success('Profil suspendu, signalement traité.');
                    refresh();
                }} />
        </Card>
    );
}

/**
 * Reports from members. A profile is suspended on its own once it reaches the
 * report threshold set in Réglages; the rest is decided here.
 */
export function ReportsTab() {
    const [status, setStatus] = useState<ReportStatus | ''>(ReportStatus.OPEN);
    const [page, setPage] = useState(1);
    const q = useQuery({
        queryKey: ['sbclove', 'reports', status, page],
        queryFn: () => listReports({ status: status || undefined, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    return (
        <div className="space-y-3">
            <div className="sm:w-64"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as ReportStatus | ''); setPage(1); }}>
                <option value="open">Ouverts</option><option value="reviewed">Traités</option><option value="dismissed">Sans suite</option><option value="">Tous</option>
            </Select></div>
            {q.isLoading ? <ListSkeleton rows={3} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} />
                : !q.data?.data.length ? <Card><EmptyState title={status === ReportStatus.OPEN ? 'Aucun signalement ouvert' : 'Aucun signalement'} /></Card>
                    : <div className="grid gap-3 lg:grid-cols-2">{q.data.data.map(r => <ReportCard key={r._id} r={r} />)}</div>}
            {q.data && q.data.pagination.total > PAGE && <Pagination page={page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.total} onChange={setPage} />}
        </div>
    );
}
