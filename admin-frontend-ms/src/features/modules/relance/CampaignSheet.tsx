import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, ConfirmSheet, EmptyState, ErrorState, KeyValue, MemberLink, Pagination, SectionTitle, Sheet, Skeleton, StatusBadge, Tabs, notify } from '../../../ui';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { countryName } from '../../../lib/labels';
import {
    CAMPAIGN_STATUS, CHANNEL, DELIVERY, EXIT_REASON, cancelCampaign, getCampaignRecent, getCampaignStats, listCampaignTargets,
    pauseCampaign, resumeCampaign, type Campaign, type Target,
} from './api';

const STOP = ['Messages trompeurs', 'Plainte des filleuls', 'Demande du parrain', 'Envois en double'];

const SUBSCRIPTION: Record<string, string> = { subscribed: 'Abonnés', 'non-subscribed': 'Non abonnés' };
const GENDER: Record<string, string> = { male: 'Hommes', female: 'Femmes', other: 'Autre' };

/** Who the parrain chose, in words. */
function audience(c: Campaign): Array<[string, string]> {
    const f = c.targetFilter ?? {};
    const rows: Array<[string, string]> = [];
    if (f.countries?.length) rows.push(['Pays', f.countries.map(countryName).join(', ')]);
    if (f.registrationDateFrom || f.registrationDateTo) rows.push(['Inscrits', `du ${f.registrationDateFrom ? formatDate(f.registrationDateFrom) : '…'} au ${f.registrationDateTo ? formatDate(f.registrationDateTo) : '…'}`]);
    if (f.subscriptionStatus && f.subscriptionStatus !== 'all') rows.push(['Abonnement', SUBSCRIPTION[f.subscriptionStatus] ?? f.subscriptionStatus]);
    if (f.gender && f.gender !== 'all') rows.push(['Sexe', GENDER[f.gender] ?? f.gender]);
    if (f.minAge || f.maxAge) rows.push(['Âge', `${f.minAge ?? '…'} – ${f.maxAge ?? '…'} ans`]);
    if (f.professions?.length) rows.push(['Professions', f.professions.join(', ')]);
    if (f.maxTargets) rows.push(['Limite', `${formatNumber(f.maxTargets)} filleuls au plus`]);
    if (!rows.length) rows.push(['Filleuls', 'Tous ses filleuls']);
    return rows;
}

function Figures({ c }: { c: Campaign }) {
    const q = useQuery({ queryKey: ['relance', 'campaign-stats', c._id], queryFn: () => getCampaignStats(c._id) });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    const s = q.data;
    if (!s) return <Skeleton className="h-40" />;
    const days = s.dayProgression.filter(d => d.count > 0);
    return (
        <div className="space-y-5">
            <KeyValue items={[
                ['Filleuls entrés', formatNumber(s.totalEnrolled)],
                ['Encore en cours', formatNumber(s.activeTargets)],
                ['Ont payé', <span className="text-success">{formatNumber(s.targetsConverted)}</span>],
                ['7 jours finis sans payer', formatNumber(s.completedRelance)],
                ['Sortis autrement', formatNumber(s.targetsExited)],
            ]} />
            <div>
                <SectionTitle>Messages</SectionTitle>
                <KeyValue items={[
                    ['Envoyés', formatNumber(s.totalMessagesDelivered)],
                    ['Échecs', s.totalMessagesFailed ? <span className="text-danger">{formatNumber(s.totalMessagesFailed)}</span> : '0'],
                    ['E-mails ouverts', `${s.openRate} %`],
                    ['Clics sur un lien', `${s.clickRate} %`],
                ]} />
            </div>
            {days.length > 0 && (
                <div>
                    <SectionTitle>Où en sont les filleuls en cours</SectionTitle>
                    <div className="flex flex-wrap gap-1.5">
                        {days.map(d => <Badge key={d.day} tone="primary">Jour {d.day} · {formatNumber(d.count)}</Badge>)}
                    </div>
                </div>
            )}
        </div>
    );
}

function targetState(t: Target) {
    if (t.status === 'active') return <Badge tone="primary">Jour {t.currentDay}</Badge>;
    if (t.status === 'paused') return <Badge tone="warning">En pause</Badge>;
    return <StatusBadge status={t.exitReason ?? 'completed_7days'} labels={EXIT_REASON} />;
}

function Filleuls({ c }: { c: Campaign }) {
    const [page, setPage] = useState(1);
    const q = useQuery({ queryKey: ['relance', 'campaign-targets', c._id, page], queryFn: () => listCampaignTargets(c._id, page, 20), placeholderData: keepPreviousData });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    if (!q.data) return <Skeleton className="h-40" />;
    if (!q.data.targets.length) return <EmptyState title="Aucun filleul pour l’instant" />;
    return (
        <div className="space-y-3">
            <ul className="divide-y divide-border border border-border rounded-tile">
                {q.data.targets.map(t => {
                    const last = t.messagesDelivered[t.messagesDelivered.length - 1];
                    return (
                        <li key={t._id} className="px-3 py-2.5 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                                <MemberLink id={t.referralUserId} name={t.referralUser?.name ?? 'Filleul introuvable'} phone={t.referralUser?.phoneNumber}
                                    sub={last ? `Dernier message ${formatDateTime(last.sentAt)}` : 'Aucun message encore'} />
                            </div>
                            {targetState(t)}
                        </li>
                    );
                })}
            </ul>
            <Pagination page={page} totalPages={Math.max(1, q.data.pagination.pages)} total={q.data.pagination.total} onChange={setPage} />
        </div>
    );
}

function Recent({ c }: { c: Campaign }) {
    const q = useQuery({ queryKey: ['relance', 'campaign-recent', c._id], queryFn: () => getCampaignRecent(c._id, 30) });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    if (!q.data) return <Skeleton className="h-40" />;
    if (!q.data.messages.length) return <EmptyState title="Aucun message envoyé" />;
    return (
        <ul className="divide-y divide-border border border-border rounded-tile">
            {q.data.messages.map((m, i) => (
                <li key={i} className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <MemberLink id={m.referralUser?._id} name={m.referralUser?.name ?? 'Filleul introuvable'} avatar={m.referralUser?.avatar}
                                sub={`Jour ${m.day} · ${formatDateTime(m.sentAt)}`} />
                        </div>
                        <StatusBadge status={m.status} labels={DELIVERY} />
                    </div>
                    {m.errorMessage && <p className="mt-1.5 text-xs text-danger break-words">{m.errorMessage}</p>}
                </li>
            ))}
        </ul>
    );
}

/** One campaign: who it targets, how it is doing, and pause/resume/stop. */
export function CampaignSheet({ campaign: c, onClose }: { campaign: Campaign; onClose: () => void }) {
    const qc = useQueryClient();
    const [tab, setTab] = useState<'chiffres' | 'filleuls' | 'envois'>('chiffres');
    const [action, setAction] = useState<'pause' | 'resume' | 'cancel' | null>(null);
    const refresh = () => qc.invalidateQueries({ queryKey: ['relance'] });
    const canPause = c.status === 'active';
    const canResume = c.status === 'paused';
    const canStop = c.status !== 'completed' && c.status !== 'cancelled';

    return (
        <Sheet open onClose={onClose} size="lg" title={c.name}
            footer={canStop ? (
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="danger-soft" onClick={() => setAction('cancel')}>Arrêter…</Button>
                    {canPause ? <Button variant="secondary" onClick={() => setAction('pause')}>Mettre en pause</Button>
                        : canResume ? <Button onClick={() => setAction('resume')}>Reprendre</Button> : <span />}
                </div>
            ) : undefined}>
            <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={c.status} labels={CAMPAIGN_STATUS} />
                    {c.channel && <Badge>{CHANNEL[c.channel] ?? c.channel}</Badge>}
                    {c.customMessages?.length ? <Badge tone="accent">Messages du parrain</Badge> : <Badge>Messages SBC</Badge>}
                </div>
                <div>
                    <SectionTitle>Parrain</SectionTitle>
                    <MemberLink id={c.userId} name={c.owner?.name ?? 'Parrain introuvable'} phone={c.owner?.phoneNumber} />
                </div>
                <div>
                    <SectionTitle>Filleuls visés</SectionTitle>
                    <KeyValue items={audience(c)} />
                </div>
                <KeyValue items={[
                    ['Créée', formatDate(c.createdAt)],
                    c.scheduledStartDate && c.status === 'scheduled' ? ['Démarre', formatDateTime(c.scheduledStartDate)] : null,
                    c.actualStartDate ? ['Lancée', formatDate(c.actualStartDate)] : null,
                    c.pausedAt && c.status === 'paused' ? ['En pause depuis', formatDateTime(c.pausedAt)] : null,
                    c.actualEndDate ? ['Terminée', formatDate(c.actualEndDate)] : null,
                    c.cancelledAt ? ['Arrêtée', formatDate(c.cancelledAt)] : null,
                    c.cancelReason ? ['Motif', c.cancelReason] : null,
                ]} />
                <Tabs value={tab} onChange={setTab} items={[{ value: 'chiffres', label: 'Chiffres' }, { value: 'filleuls', label: 'Filleuls' }, { value: 'envois', label: 'Derniers envois' }]} />
                {tab === 'filleuls' ? <Filleuls c={c} /> : tab === 'envois' ? <Recent c={c} /> : <Figures c={c} />}
            </div>

            <ConfirmSheet open={action === 'pause'} onClose={() => setAction(null)} title={`Mettre « ${c.name} » en pause ?`}
                message={<p>Plus aucun message ne part tant qu’elle est en pause. Les filleuls gardent leur place et le parrain peut la reprendre.</p>}
                confirmLabel="Mettre en pause"
                onConfirm={async () => { await pauseCampaign(c._id); notify.success('Campagne en pause.'); refresh(); }} />
            <ConfirmSheet open={action === 'resume'} onClose={() => setAction(null)} tone="success" title={`Reprendre « ${c.name} » ?`}
                message={<p>Les messages repartent là où ils s’étaient arrêtés, avec les crédits du parrain.</p>}
                confirmLabel="Reprendre"
                onConfirm={async () => { await resumeCampaign(c._id); notify.success('Campagne reprise.'); refresh(); }} />
            <ConfirmSheet open={action === 'cancel'} onClose={() => setAction(null)} tone="danger" title={`Arrêter « ${c.name} » ?`}
                message={<p>Les filleuls encore en cours sortent de la campagne et ne reçoivent plus rien. C’est définitif. Les crédits non utilisés restent au parrain.</p>}
                reason={{ label: 'Motif', suggestions: STOP, minLength: 5 }}
                confirmLabel="Arrêter la campagne"
                onConfirm={async (reason) => { await cancelCampaign(c._id, reason); notify.success('Campagne arrêtée.'); refresh(); }} />
        </Sheet>
    );
}
