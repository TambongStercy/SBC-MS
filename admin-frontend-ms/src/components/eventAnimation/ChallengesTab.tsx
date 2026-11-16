import { useEffect, useState } from 'react';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, fmtDate, listAnimationChallenges, num, xaf, type AnimChallenge, type ChallengeStatus } from '../../api/animation';
import { CHALLENGE_STATUS, useAnim, useAsync } from './shared';
import { Badge, Pager, StatusBadge, Table, inputCls, selectCls, tdCls, trCls } from './ui';
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
    const { param, setParams } = useAnim();
    const status = param('statut');
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);

    // debounced so typing doesn't fire a request per keystroke
    useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 400); return () => clearTimeout(t); }, [search]);

    const list = useAsync(
        () => listAnimationChallenges({ q: q || undefined, status: (status || undefined) as ChallengeStatus | undefined, page, limit: PAGE }),
        `${q}|${status}|${page}`,
    );
    const items = list.data?.items ?? [];

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un défi par nom" className={`${inputCls} w-72`} />
                <select value={status} onChange={e => { setParams({ tab: 'defis', statut: e.target.value }); setPage(1); }} className={selectCls}>
                    <option value="">Tous les statuts</option>
                    {CHALLENGE_STATUSES.map(s => <option key={s} value={s}>{CHALLENGE_STATUS_LABELS[s]}</option>)}
                </select>
            </div>
            <Table headers={['Défi', 'Statut', 'Candidats', 'Votes gratuits', 'Votes payants', 'Revenus', 'Mis à jour']}
                loading={list.loading && !list.data} error={list.data ? null : list.error} onRetry={list.reload}
                empty={list.data && items.length === 0 ? (q ? `Aucun défi ne correspond à « ${q} »` : 'Aucun défi') : undefined}>
                {items.map(c => (
                    <tr key={c._id} className={trCls} onClick={() => setOpenId(c._id)}>
                        <td className={tdCls}><div className="font-medium">{c.name}</div><div className="text-xs text-fg-muted">{c.event?.title ?? 'Événement'}</div></td>
                        <td className={tdCls}><Status c={c} /></td>
                        <td className={`${tdCls} text-right`}>{num(c.counters?.candidates)}</td>
                        <td className={`${tdCls} text-right`}>{num(c.counters?.freeVotes)}</td>
                        <td className={`${tdCls} text-right`}>{num(c.counters?.paidVotes)}</td>
                        <td className={`${tdCls} text-right whitespace-nowrap`}>{xaf(c.counters?.paidRevenue)}</td>
                        <td className={`${tdCls} text-xs text-fg-muted whitespace-nowrap`}>{fmtDate(c.updatedAt)}</td>
                    </tr>
                ))}
            </Table>
            {list.data && <Pager page={page} totalPages={Math.max(1, list.data.totalPages)} total={list.data.total} onChange={setPage} />}
            {openId && <ChallengeDetail id={openId} onClose={() => setOpenId(null)} />}
        </div>
    );
}
