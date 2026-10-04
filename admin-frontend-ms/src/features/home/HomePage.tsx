import { useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Flag, Heart, Hourglass, Megaphone, RefreshCw, Ticket, Video, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Card, EmptyState, IconButton, NavList, NavRow, SectionTitle, Skeleton, Stat, Page, type Tone } from '../../ui';
import { formatNumber, timeAgo } from '../../lib/format';
import { useQueueCounts, useToday, type QueueKey } from './queues';

const LOOK: Record<QueueKey, { icon: LucideIcon; tone: Tone }> = {
    proofs: { icon: Video, tone: 'primary' },
    withdrawals: { icon: Banknote, tone: 'success' },
    campaigns: { icon: Megaphone, tone: 'accent' },
    love: { icon: Heart, tone: 'danger' },
    organizers: { icon: Ticket, tone: 'primary' },
    disputes: { icon: Flag, tone: 'warning' },
    stuck: { icon: Hourglass, tone: 'danger' },
};

// "Dimanche 4 octobre": only the first letter capitalised, as French writes it.
const todayLabel = (() => { const t = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); return t[0].toUpperCase() + t.slice(1); })();

/**
 * Home: everything waiting for a decision, with counts, then today's figures.
 * Each count opens the list behind it.
 */
export default function HomePage() {
    const { role } = useAuth();
    const qc = useQueryClient();
    const { defs, results } = useQueueCounts(role);
    const isAdmin = role === 'admin';
    const todayQ = useToday(role);

    const rows = defs.map((def, i) => ({ def, q: results[i] }));
    const waiting = rows.filter(r => (r.q.data?.count ?? 0) > 0 || r.q.isError);
    const clear = rows.filter(r => r.q.data && r.q.data.count === 0);
    const loading = rows.some(r => r.q.isLoading);

    const refresh = () => { qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['today'] }); };

    return (
        <Page title="Accueil" subtitle={todayLabel}
            actions={<IconButton label="Actualiser" onClick={refresh}><RefreshCw size={20} /></IconButton>}>
            <div className="space-y-6">
                <section>
                    {loading && waiting.length === 0 ? (
                        <div className="space-y-2">{defs.map(d => <Skeleton key={d.key} className="h-[68px] rounded-card" />)}</div>
                    ) : waiting.length === 0 ? (
                        <Card><EmptyState icon={<CheckCircle2 size={26} className="text-success" />} title="Tout est à jour">Rien n'attend de décision pour le moment.</EmptyState></Card>
                    ) : (
                        <NavList>
                            {waiting.map(({ def, q }) => {
                                const { icon: Icon, tone } = LOOK[def.key];
                                const d = q.data;
                                const sub = q.isError ? 'Impossible de compter pour le moment'
                                    : d?.oldest ? `La plus ancienne : ${timeAgo(d.oldest)}` : d?.detail;
                                return (
                                    <NavRow key={def.key} to={def.to} icon={<Icon size={20} />} tone={tone} title={def.title} description={sub}
                                        trailing={<span className={q.isError ? 'text-ink-3 font-bold' : 'min-w-8 text-center rounded-pill bg-primary px-2.5 py-0.5 text-sm font-bold text-white tabular'}>
                                            {q.isError ? '—' : formatNumber(d?.count)}
                                        </span>} />
                                );
                            })}
                        </NavList>
                    )}
                    {clear.length > 0 && waiting.length > 0 && (
                        <p className="mt-3 text-sm text-ink-3">
                            <CheckCircle2 size={14} className="inline -mt-0.5 mr-1 text-success" />
                            À jour : {clear.map(r => r.def.title.toLowerCase()).join(', ')}.
                        </p>
                    )}
                </section>

                {todayQ.data !== undefined || todayQ.isLoading ? (
                    <section>
                        <SectionTitle>Aujourd'hui</SectionTitle>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            {isAdmin && (
                                <>
                                    <Stat label="Inscriptions" value={formatNumber(todayQ.data?.signups)} loading={todayQ.isLoading} to="/membres?depuis=aujourdhui" />
                                    <Stat label="Paiements réussis" value={formatNumber(todayQ.data?.paid)} loading={todayQ.isLoading} to="/argent/paiements" />
                                    <Stat label="Paiements échoués" value={formatNumber(todayQ.data?.failed)} loading={todayQ.isLoading} to="/argent/paiements" />
                                </>
                            )}
                            <Stat label="Retraits validés" value={formatNumber(todayQ.data?.withdrawalsApproved)} loading={todayQ.isLoading}
                                hint={todayQ.data?.withdrawalsRejected ? `${todayQ.data.withdrawalsRejected} refusés` : undefined} to="/argent/retraits?vue=historique" />
                        </div>
                    </section>
                ) : null}
            </div>
        </Page>
    );
}
