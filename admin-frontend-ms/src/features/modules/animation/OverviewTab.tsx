import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, REWARD_WINNER_STATUS_LABELS, getAnimationStats } from '../../../api/animation';
import { Button, Card, DataList, EmptyState, ErrorState, Input, SectionTitle, Stat, type Column } from '../../../ui';
import { formatMoney, formatNumber } from '../../../lib/format';

/** <input type="date"> value → ISO instant at local midnight; `to` is made inclusive (the server uses $lt). */
const dayStart = (d: string, plusDays = 0) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day + plusDays).toISOString();
};

type RankRow = { id: string; name: string; challenges: number; votes: number; revenue: number };

/** Module figures over a period: challenges, votes, paid-vote money, rewards, top events and organisers. */
export function OverviewTab() {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const rangeInvalid = Boolean(from && to && from > to);
    const q = useQuery({
        queryKey: ['animation', 'stats', from, to],
        queryFn: () => getAnimationStats({ from: from ? dayStart(from) : undefined, to: to ? dayStart(to, 1) : undefined }),
        enabled: !rangeInvalid,
        placeholderData: keepPreviousData,
    });
    const s = q.data;
    const L = q.isLoading;

    return (
        <div className="space-y-5">
            <Card className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
                    <div className="sm:w-48"><Input label="Du" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
                    <div className="sm:w-48"><Input label="Au (inclus)" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
                    {(from || to) && <Button variant="secondary" className="col-span-2" onClick={() => { setFrom(''); setTo(''); }}>Toute la période</Button>}
                </div>
                {rangeInvalid && <p className="text-sm text-danger">La date de début est après la date de fin.</p>}
                <p className="text-xs text-ink-3">
                    La période filtre les défis, candidats, transactions et récompenses par date de création.
                    Les signalements ouverts sont toujours comptés en totalité.
                </p>
            </Card>

            {q.isError && !s ? <ErrorState onRetry={() => q.refetch()} /> : (
                <div className={q.isFetching && !L ? 'opacity-60 transition-opacity space-y-5' : 'space-y-5'}>
                    {!!s?.openFraudFlags && (
                        <Link to="?onglet=a-verifier" className="flex items-start gap-3 rounded-card border border-warning bg-warning-soft p-3.5 text-sm text-ink hover:opacity-90">
                            <ShieldAlert size={20} className="text-warning shrink-0 mt-0.5" />
                            <span>
                                <b>{formatNumber(s.openFraudFlags)} signalement{s.openFraudFlags > 1 ? 's' : ''} de fraude à vérifier.</b>{' '}
                                Tant qu’un signalement à score élevé est ouvert, le résultat du défi concerné ne peut pas être figé.
                                <span className="block mt-1 font-semibold text-primary">Ouvrir « À vérifier »</span>
                            </span>
                        </Link>
                    )}

                    <section>
                        <SectionTitle>Le module</SectionTitle>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <Stat label="Événements utilisant le module" value={formatNumber(s?.eventsUsingModule)} loading={L} />
                            <Stat label="Défis" value={formatNumber(s?.challenges.total)} loading={L} to="?onglet=defis" />
                            <Stat label="Candidats" value={formatNumber(s?.candidates)} loading={L} />
                            <Stat label="Signalements ouverts" value={formatNumber(s?.openFraudFlags)} loading={L} hint="File « À vérifier »"
                                tone={s?.openFraudFlags ? 'warning' : undefined} to="?onglet=a-verifier" />
                        </div>
                    </section>

                    <section>
                        <SectionTitle>Votes</SectionTitle>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <Stat label="Votes gratuits" value={formatNumber(s?.votes.free)} loading={L} />
                            <Stat label="Votes payants" value={formatNumber(s?.votes.paid)} loading={L} />
                            <Stat label="Volume votes payants" value={s ? formatMoney(s.paid.volume) : '—'} loading={L}
                                hint={s ? `${formatNumber(s.paid.transactions)} transaction${s.paid.transactions > 1 ? 's' : ''} payée${s.paid.transactions > 1 ? 's' : ''}` : undefined} />
                            <Stat label="Commission SBC" value={s ? formatMoney(s.paid.commission) : '—'} loading={L} tone="success" />
                            <Stat label="Remboursé" value={s ? formatMoney(s.paid.refunded) : '—'} loading={L} />
                            <Stat label="Transactions en attente" value={formatNumber(s?.paid.pending)} hint="Paiements non confirmés" loading={L} to="?onglet=votes" />
                        </div>
                    </section>

                    <section>
                        <SectionTitle>Récompenses par statut</SectionTitle>
                        <Card>
                            {L ? <p className="text-sm text-ink-3">Chargement…</p> : !s || Object.keys(s.rewards).length === 0 ? (
                                <p className="text-sm text-ink-3">Aucune récompense attribuée.</p>
                            ) : (
                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                    {Object.entries(s.rewards).map(([k, n]) => (
                                        <span key={k} className="text-sm"><b className="tabular">{formatNumber(n)}</b> <span className="text-ink-2">{REWARD_WINNER_STATUS_LABELS[k] ?? 'Autres'}</span></span>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </section>

                    <section>
                        <SectionTitle action={<Link to="?onglet=defis" className="text-sm font-semibold text-primary">Voir les défis</Link>}>Défis par statut</SectionTitle>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {CHALLENGE_STATUSES.map(st => (
                                <Stat key={st} label={CHALLENGE_STATUS_LABELS[st]} value={formatNumber(s?.challenges.byStatus[st] ?? 0)} loading={L}
                                    to={`?onglet=defis&statut=${st}`} />
                            ))}
                        </div>
                    </section>

                    <div className="grid lg:grid-cols-2 gap-5">
                        <RankList title="Top événements (par votes)" firstCol="Événement" loading={L}
                            rows={s?.perEvent.map(e => ({ id: e._id, name: e.title ?? 'Événement sans titre', challenges: e.challenges, votes: e.votes, revenue: e.revenue }))} />
                        <RankList title="Top organisateurs (par revenus)" firstCol="Organisateur" loading={L}
                            rows={s?.perOrganizer.map(o => ({ id: o._id, name: o.name ?? 'Organisateur sans nom', challenges: o.challenges, votes: o.votes, revenue: o.revenue }))} />
                    </div>
                </div>
            )}
        </div>
    );
}

function RankList({ title, firstCol, rows, loading }: { title: string; firstCol: string; rows?: RankRow[]; loading: boolean }) {
    const cols: Column<RankRow>[] = [
        { key: 'n', header: firstCol, cell: r => <span className="font-semibold">{r.name}</span> },
        { key: 'c', header: 'Défis', align: 'right', cell: r => formatNumber(r.challenges) },
        { key: 'v', header: 'Votes', align: 'right', cell: r => formatNumber(r.votes) },
        { key: 'r', header: 'Revenus votes', align: 'right', cell: r => <span className="whitespace-nowrap">{formatMoney(r.revenue)}</span> },
    ];
    return (
        <section>
            <SectionTitle>{title}</SectionTitle>
            <DataList rows={rows} columns={cols} rowKey={r => r.id} loading={loading} empty={<Card><EmptyState title="Aucune donnée" /></Card>}
                card={r => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{r.name}</span>
                            <span className="block text-xs text-ink-2">{formatNumber(r.challenges)} défis · {formatNumber(r.votes)} votes</span></span>
                        <span className="text-sm font-semibold tabular whitespace-nowrap">{formatMoney(r.revenue)}</span>
                    </span>
                )} />
        </section>
    );
}
