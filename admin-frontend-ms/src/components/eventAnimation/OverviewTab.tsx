import { useState } from 'react';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, REWARD_WINNER_STATUS_LABELS, getAnimationStats, num, xaf } from '../../api/animation';
import { useAnim, useAsync, plural } from './shared';
import { Button, Card, Section, Stat, Table, inputCls, tdCls } from './ui';

/** <input type="date"> value → ISO instant at local midnight; `to` is made inclusive (the server uses $lt). */
const dayStart = (d: string, plusDays = 0) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day + plusDays).toISOString();
};

type RankRow = { id: string; name: string; challenges: number; votes: number; revenue: number };

/** Module figures over a period: challenges, votes, paid-vote money, rewards, top events and organisers. */
export default function OverviewTab() {
    const { setParams } = useAnim();
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const rangeInvalid = Boolean(from && to && from > to);
    const q = useAsync(
        () => getAnimationStats({ from: from ? dayStart(from) : undefined, to: to ? dayStart(to, 1) : undefined }),
        `${from}|${to}`, !rangeInvalid,
    );
    const s = q.data;
    const v = (n?: number) => (s ? num(n ?? 0) : '…');

    return (
        <div className="space-y-6">
            <Card className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm text-gray-300">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inputCls} block mt-1`} /></label>
                    <label className="text-sm text-gray-300">Au (inclus)<input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inputCls} block mt-1`} /></label>
                    {(from || to) && <Button onClick={() => { setFrom(''); setTo(''); }}>Toute la période</Button>}
                </div>
                {rangeInvalid && <p className="text-sm text-red-400">La date de début est après la date de fin.</p>}
                <p className="text-xs text-gray-400">
                    La période filtre les défis, candidats, transactions et récompenses par date de création.
                    Les signalements ouverts sont toujours comptés en totalité.
                </p>
            </Card>

            {q.error && !s ? (
                <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-xl p-4">
                    {q.error} <button onClick={q.reload} className="underline ml-2">Réessayer</button>
                </div>
            ) : (
                <div className={`space-y-6 ${q.loading && s ? 'opacity-60 transition-opacity' : ''}`}>
                    {!!s?.openFraudFlags && (
                        <button type="button" onClick={() => setParams({ tab: 'a-verifier' })}
                            className="w-full text-left rounded-xl border border-amber-600 bg-amber-900/30 p-4 text-sm text-amber-100 hover:bg-amber-900/50">
                            <b>{num(s.openFraudFlags)} {plural(s.openFraudFlags, 'signalement')} de fraude à vérifier.</b>{' '}
                            Tant qu’un signalement à score élevé est ouvert, le résultat du défi concerné ne peut pas être figé.
                            <span className="block mt-1 font-semibold text-blue-300">Ouvrir « À vérifier »</span>
                        </button>
                    )}

                    <Section title="Le module">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <Stat label="Événements utilisant le module" value={v(s?.eventsUsingModule)} />
                            <Stat label="Défis" value={v(s?.challenges.total)} onClick={() => setParams({ tab: 'defis' })} />
                            <Stat label="Candidats" value={v(s?.candidates)} />
                            <Stat label="Signalements ouverts" value={v(s?.openFraudFlags)} hint="File « À vérifier »"
                                tone={s?.openFraudFlags ? 'warning' : undefined} onClick={() => setParams({ tab: 'a-verifier' })} />
                        </div>
                    </Section>

                    <Section title="Votes">
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            <Stat label="Votes gratuits" value={v(s?.votes.free)} />
                            <Stat label="Votes payants" value={v(s?.votes.paid)} />
                            <Stat label="Volume votes payants" value={s ? xaf(s.paid.volume) : '…'}
                                hint={s ? `${num(s.paid.transactions)} ${plural(s.paid.transactions, 'transaction payée', 'transactions payées')}` : undefined} />
                            <Stat label="Commission SBC" value={s ? xaf(s.paid.commission) : '…'} tone="success" />
                            <Stat label="Remboursé" value={s ? xaf(s.paid.refunded) : '…'} />
                            <Stat label="Transactions en attente" value={v(s?.paid.pending)} hint="Paiements non confirmés" onClick={() => setParams({ tab: 'votes' })} />
                        </div>
                    </Section>

                    <Section title="Récompenses par statut">
                        <Card>
                            {!s ? <p className="text-sm text-gray-400">Chargement…</p> : Object.keys(s.rewards).length === 0 ? (
                                <p className="text-sm text-gray-400">Aucune récompense attribuée.</p>
                            ) : (
                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                    {Object.entries(s.rewards).map(([k, n]) => (
                                        <span key={k} className="text-sm"><b>{num(n)}</b> <span className="text-gray-400">{REWARD_WINNER_STATUS_LABELS[k] ?? 'Autres'}</span></span>
                                    ))}
                                </div>
                            )}
                        </Card>
                    </Section>

                    <Section title="Défis par statut" action={<button onClick={() => setParams({ tab: 'defis' })} className="text-sm font-semibold text-blue-300">Voir les défis</button>}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {CHALLENGE_STATUSES.map(st => (
                                <Stat key={st} label={CHALLENGE_STATUS_LABELS[st]} value={v(s?.challenges.byStatus[st])}
                                    onClick={() => setParams({ tab: 'defis', statut: st })} />
                            ))}
                        </div>
                    </Section>

                    <div className="grid lg:grid-cols-2 gap-6">
                        <RankList title="Top événements (par votes)" firstCol="Événement" loading={!s}
                            rows={s?.perEvent.map(e => ({ id: e._id, name: e.title ?? 'Événement sans titre', challenges: e.challenges, votes: e.votes, revenue: e.revenue }))} />
                        <RankList title="Top organisateurs (par revenus)" firstCol="Organisateur" loading={!s}
                            rows={s?.perOrganizer.map(o => ({ id: o._id, name: o.name ?? 'Organisateur sans nom', challenges: o.challenges, votes: o.votes, revenue: o.revenue }))} />
                    </div>
                </div>
            )}
        </div>
    );
}

function RankList({ title, firstCol, rows, loading }: { title: string; firstCol: string; rows?: RankRow[]; loading: boolean }) {
    return (
        <Section title={title}>
            <Table headers={[firstCol, 'Défis', 'Votes', 'Revenus votes']} loading={loading} empty={rows && rows.length === 0 ? 'Aucune donnée' : undefined}>
                {rows?.map(r => (
                    <tr key={r.id} className="border-t border-gray-700">
                        <td className={`${tdCls} font-medium`}>{r.name}</td>
                        <td className={`${tdCls} text-right`}>{num(r.challenges)}</td>
                        <td className={`${tdCls} text-right`}>{num(r.votes)}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{xaf(r.revenue)}</td>
                    </tr>
                ))}
            </Table>
        </Section>
    );
}
