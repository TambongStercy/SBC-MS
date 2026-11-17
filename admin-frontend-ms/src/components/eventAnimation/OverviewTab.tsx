import { Award01Icon, Money03Icon, ThumbsUpIcon } from '@hugeicons/core-free-icons';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, REWARD_WINNER_STATUS_LABELS, getAnimationStats, num } from '../../api/animation';
import { Metric, Panel, PanelBody, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../ui';
import { DetailList, ErrorState, Money, formatMoney, formatNumber } from '../moduleKit';
import { useAnim, useAsync, plural } from './shared';

type RankRow = { id: string; name: string; challenges: number; votes: number; revenue: number };

/**
 * Module figures over a period: four key figures, challenges by status
 * (each opens the filtered list), rewards, top events and organisers, and the
 * other counts in a details list.
 */
export default function OverviewTab() {
    const { setParams, apiParams, scopeKey } = useAnim();
    // Country and period come from the page's filter row ({country?, from?, to?}).
    const q = useAsync(() => getAnimationStats(apiParams), scopeKey);
    const s = q.data;
    const sk = <Skeleton className="h-8 w-24" />;
    const maxStatus = s ? Math.max(1, ...CHALLENGE_STATUSES.map(st => s.challenges.byStatus[st] ?? 0)) : 1;

    return (
        <div className="space-y-6">
            <p className="text-xs text-fg-muted">
                La période filtre les défis, candidats, transactions et récompenses par date de création. Les signalements ouverts sont toujours comptés en totalité.
            </p>

            {q.error && !s ? (
                <Panel><ErrorState error={new Error(q.error)} onRetry={q.reload} /></Panel>
            ) : (
                <div className={`space-y-6 ${q.loading && s ? 'opacity-60 transition-opacity' : ''}`}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Metric label="Défis" icon={Award01Icon} value={s ? formatNumber(s.challenges.total) : sk}
                            hint={s ? `${formatNumber(s.eventsUsingModule)} ${plural(s.eventsUsingModule, 'événement')} · ${formatNumber(s.candidates)} candidats` : undefined}
                            onClick={() => setParams({ tab: 'defis' })} />
                        <Metric label="Votes" icon={ThumbsUpIcon} value={s ? formatNumber(s.votes.free + s.votes.paid) : sk}
                            hint={s ? `${formatNumber(s.votes.free)} gratuits · ${formatNumber(s.votes.paid)} payants` : undefined} />
                        <Metric label="Votes payants encaissés" icon={Money03Icon} tone="primary" value={s ? formatMoney(s.paid.volume) : sk}
                            hint={s ? `${formatNumber(s.paid.transactions)} ${plural(s.paid.transactions, 'achat payé', 'achats payés')}` : undefined}
                            onClick={() => setParams({ tab: 'votes' })} />
                        <Metric label="Commission SBC" icon={Money03Icon} tone="success" value={s ? formatMoney(s.paid.commission) : sk}
                            hint={s ? `Remboursé : ${formatMoney(s.paid.refunded)}` : undefined} />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Panel>
                            <PanelHeader title="Défis par statut" description="Choisissez un statut pour voir ses défis." />
                            <PanelBody>
                                {!s ? <Skeleton className="h-48 w-full" /> : (
                                    <ul className="space-y-1">
                                        {CHALLENGE_STATUSES.map(st => {
                                            const n = s.challenges.byStatus[st] ?? 0;
                                            return (
                                                <li key={st}>
                                                    <button type="button" onClick={() => setParams({ tab: 'defis', statut: st })}
                                                        className="block min-h-11 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2">
                                                        <span className="flex items-baseline justify-between gap-3 text-sm">
                                                            <span className="text-fg">{CHALLENGE_STATUS_LABELS[st]}</span>
                                                            <span className="tabular-nums text-fg">{formatNumber(n)}</span>
                                                        </span>
                                                        <span className="mt-1 block h-1.5 w-full" aria-hidden="true">
                                                            {n > 0 && <span className="block h-1.5 rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(2, (n / maxStatus) * 100)}%` }} />}
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </PanelBody>
                        </Panel>

                        <Panel>
                            <PanelHeader title="Autres chiffres" />
                            <PanelBody className="space-y-4">
                                {!s ? <Skeleton className="h-48 w-full" /> : (
                                    <>
                                        <DetailList items={[
                                            ['Événements utilisant le module', formatNumber(s.eventsUsingModule)],
                                            ['Candidats', formatNumber(s.candidates)],
                                            ['Signalements ouverts', <button key="f" type="button" className="text-primary hover:underline" onClick={() => setParams({ tab: 'a-verifier' })}>{formatNumber(s.openFraudFlags)}</button>],
                                            ['Paiements de votes non confirmés', <button key="p" type="button" className="text-primary hover:underline" onClick={() => setParams({ tab: 'votes' })}>{formatNumber(s.paid.pending)}</button>],
                                            ['Montant remboursé', formatMoney(s.paid.refunded)],
                                        ]} />
                                        <div>
                                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Récompenses par statut</p>
                                            {Object.keys(s.rewards).length === 0 ? <p className="text-sm text-fg-muted">Aucune récompense attribuée.</p> : (
                                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                                    {Object.entries(s.rewards).map(([k, n]) => (
                                                        <span key={k} className="text-sm"><span className="font-semibold tabular-nums text-fg">{num(n)}</span> <span className="text-fg-muted">{REWARD_WINNER_STATUS_LABELS[k] ?? 'Autres'}</span></span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </PanelBody>
                        </Panel>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <RankList title="Top événements" description="Classés par votes." firstCol="Événement" loading={!s}
                            rows={s?.perEvent.map(e => ({ id: e._id, name: e.title ?? 'Événement sans titre', challenges: e.challenges, votes: e.votes, revenue: e.revenue }))} />
                        <RankList title="Top organisateurs" description="Classés par revenus des votes." firstCol="Organisateur" loading={!s}
                            rows={s?.perOrganizer.map(o => ({ id: o._id, name: o.name ?? 'Organisateur sans nom', challenges: o.challenges, votes: o.votes, revenue: o.revenue }))} />
                    </div>
                </div>
            )}
        </div>
    );
}

function RankList({ title, description, firstCol, rows, loading }: { title: string; description: string; firstCol: string; rows?: RankRow[]; loading: boolean }) {
    const columns: ListColumn<RankRow>[] = [
        { key: 'name', header: firstCol, cell: r => <span className="font-medium text-fg">{r.name}</span> },
        { key: 'challenges', header: 'Défis', numeric: true, cell: r => formatNumber(r.challenges) },
        { key: 'votes', header: 'Votes', numeric: true, cell: r => formatNumber(r.votes) },
        { key: 'revenue', header: 'Revenus votes', numeric: true, cell: r => <Money value={r.revenue} /> },
    ];
    return (
        <Panel>
            <PanelHeader title={title} description={description} />
            <ResponsiveList rows={rows ?? []} columns={columns} rowKey={r => r.id} loading={loading} loadingRows={3}
                empty={<p className="px-5 pb-5 text-sm text-fg-muted">Aucune donnée.</p>} />
        </Panel>
    );
}
