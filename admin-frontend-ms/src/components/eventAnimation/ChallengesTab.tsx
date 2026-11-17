import { useEffect, useState } from 'react';
import { Award01Icon } from '@hugeicons/core-free-icons';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, listAnimationChallenges, num, type AnimChallenge, type ChallengeStatus } from '../../api/animation';
import { Button as KitButton, EmptyState, Panel, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, FilterBar, FilterSelect, Money, SearchInput } from '../moduleKit';
import { CHALLENGE_STATUS, useAnim, useAsync } from './shared';
import { Badge, Pager, StatusBadge } from './ui';
import ChallengeDetail from './ChallengeDetail';

const PAGE = 25;

function Status({ c }: { c: AnimChallenge }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            <StatusBadge status={c.status} labels={CHALLENGE_STATUS} />
            {c.suspendedAt && <Badge tone="danger">Suspendu</Badge>}
        </span>
    );
}

/** Every challenge of every event; a row opens it with its board, result, flags and actions. */
export default function ChallengesTab() {
    const { param, setParams, apiParams, scopeKey } = useAnim();
    const status = param('statut');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    // a new country/period starts again at page 1
    useEffect(() => { setPage(1); }, [scopeKey]);
    const [openId, setOpenId] = useState<string | null>(null);

    const list = useAsync(
        () => listAnimationChallenges({ q: q || undefined, status: (status || undefined) as ChallengeStatus | undefined, page, limit: PAGE, ...apiParams }),
        `${q}|${status}|${page}|${scopeKey}`,
    );
    const items = list.data?.items ?? [];
    const active = (q ? 1 : 0) + (status ? 1 : 0);
    const clear = () => { setQ(''); setPage(1); setParams({ tab: 'defis' }); };

    const columns: ListColumn<AnimChallenge>[] = [
        { key: 'name', header: 'Défi', cell: c => <div className="min-w-0"><p className="truncate font-medium text-fg">{c.name}</p><p className="truncate text-xs text-fg-muted">{c.event?.title ?? 'Événement'}</p></div> },
        { key: 'status', header: 'Statut', cell: c => <Status c={c} /> },
        { key: 'candidates', header: 'Candidats', numeric: true, cell: c => num(c.counters?.candidates) },
        { key: 'votes', header: 'Votes (gratuits · payants)', numeric: true, cell: c => `${num(c.counters?.freeVotes)} · ${num(c.counters?.paidVotes)}` },
        { key: 'revenue', header: 'Revenus', numeric: true, cell: c => <Money value={c.counters?.paidRevenue} /> },
        { key: 'updated', header: 'Mis à jour', cell: c => <DateText value={c.updatedAt} className="text-fg-muted" /> },
    ];

    return (
        <Panel>
            <div className="border-b border-line p-4">
                <FilterBar
                    search={<SearchInput value={q} onChange={v => { setQ(v.trim()); setPage(1); }} placeholder="Rechercher un défi par nom" delay={400} />}
                    filterCount={1}
                    activeCount={active}
                    onClear={clear}
                    filters={(
                        <FilterSelect label="Statut" allLabel="Tous les statuts" value={status}
                            onChange={v => { setParams({ tab: 'defis', statut: v }); setPage(1); }}
                            options={CHALLENGE_STATUSES.map(s => ({ value: s, label: CHALLENGE_STATUS_LABELS[s] }))} />
                    )}
                />
            </div>
            <div className={list.loading && list.data ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={items}
                    columns={columns}
                    rowKey={c => c._id}
                    onRowClick={c => setOpenId(c._id)}
                    loading={list.loading && !list.data}
                    empty={list.error && !list.data ? <ErrorState error={new Error(list.error)} onRetry={list.reload} /> : (
                        <EmptyState icon={Award01Icon} title={q ? `Aucun défi ne correspond à « ${q} »` : 'Aucun défi'}
                            description={active ? undefined : 'Les défis créés par les organisateurs apparaîtront ici.'}
                            action={active ? <KitButton size="lg" onClick={clear}>Effacer les filtres</KitButton> : undefined} />
                    )}
                />
            </div>
            {list.data && <Pager page={page} totalPages={Math.max(1, list.data.totalPages)} total={list.data.total} pageSize={PAGE} onChange={setPage} />}
            {openId && <ChallengeDetail id={openId} onClose={() => setOpenId(null)} />}
        </Panel>
    );
}
