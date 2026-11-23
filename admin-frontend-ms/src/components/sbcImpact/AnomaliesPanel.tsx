import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ErrorState, Money, Notice, formatDateTime, formatNumber, plural } from '../moduleKit';
import { PAY_METHOD_LABELS, flagLabel, getAnomalies, impactErrorMessage } from '../../services/impactV2Api';
import { PurchaseStatusBadge } from './shared';

const buyer = (t: { buyerName: string | null; userId: string }) => t.buyerName ?? `…${t.userId.slice(-6)}`;
const cand = (t: { candidateName: string | null; candidateId: string }) => t.candidateName ?? `…${t.candidateId.slice(-6)}`;

function Block({ title, help, count, children }: { title: string; help: string; count: number; children: ReactNode }) {
    return (
        <Panel>
            <PanelHeader title={<span className="flex items-center gap-2">{title}<Badge tone={count ? 'warning' : 'neutral'}>{formatNumber(count)}</Badge></span>} description={help} />
            <PanelBody>{count ? children : <p className="text-sm text-fg-muted">Rien à signaler.</p>}</PanelBody>
        </Panel>
    );
}

function Rows({ items }: { items: ReactNode[] }) {
    return <ul className="divide-y divide-line rounded-panel border border-line text-sm">{items.map((x, i) => <li key={i} className="px-4 py-2.5">{x}</li>)}</ul>;
}

/** What looks unusual in the votes (spec §17). Signals only: nothing is cancelled automatically. */
export default function AnomaliesPanel({ editionId }: { editionId: string }) {
    const q = useQuery({ queryKey: ['sbc-impact', 'anomalies', editionId], queryFn: () => getAnomalies(editionId) });

    if (q.isLoading) return <div className="space-y-3" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
    if (!q.data) return <Panel><ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger les anomalies.'))} onRetry={() => void q.refetch()} retrying={q.isFetching} /></Panel>;
    const { freeVotes: f, paidVotes: p } = q.data;

    return (
        <div className="space-y-4">
            <Notice>
                Ce sont des signaux à examiner : rien n’est annulé automatiquement. Pour retirer des votes payants, remboursez l’achat dans « Votes payants ».
                Les votes gratuits ne se retirent pas.
            </Notice>

            <Block title="Remboursements incertains" count={p.uncertainRefunds.length}
                help="Le remboursement n’a pas pu être confirmé : le système réessaie chaque minute avec la même référence. Prévenez la technique s’il reste là.">
                <Rows items={p.uncertainRefunds.map(t => (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                        <span><b className="font-medium">{buyer(t)}</b> · {formatNumber(t.votes)} {plural(t.votes, 'vote')} pour {cand(t)} · {PAY_METHOD_LABELS[t.method]}</span>
                        <Money value={t.amount} className="font-medium" />
                    </span>
                ))} />
            </Block>

            <Block title="Achats signalés" count={p.flagged.length} help="Par exemple un paiement d’un autre montant que le pack : ses votes n’ont pas été comptés.">
                <Rows items={p.flagged.map(t => (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                        <span><b className="font-medium">{buyer(t)}</b> · {formatNumber(t.votes)} {plural(t.votes, 'vote')} pour {cand(t)} · {formatDateTime(t.createdAt)}</span>
                        <span className="flex flex-wrap items-center gap-1">
                            {t.flags.map(fl => <Badge key={fl} tone="danger">{flagLabel(fl)}</Badge>)}
                            <PurchaseStatusBadge status={t.status} />
                            <Money value={t.amount} className="font-medium" />
                        </span>
                    </span>
                ))} />
            </Block>

            <Block title="Plus gros acheteurs" count={p.topBuyers.length} help="Les 20 comptes qui ont le plus payé de votes comptés.">
                <Rows items={p.topBuyers.map(b => (
                    <span className="flex flex-wrap items-center justify-between gap-2">
                        <span><b className="font-medium">{b.name ?? `…${b.userId.slice(-6)}`}</b> · {formatNumber(b.votes)} {plural(b.votes, 'vote')} en {formatNumber(b.purchases)} {plural(b.purchases, 'achat')}, pour {formatNumber(b.candidates)} {plural(b.candidates, 'candidat')}</span>
                        <Money value={b.amount} className="font-medium" />
                    </span>
                ))} />
            </Block>

            <Block title="Beaucoup de votants sur un même réseau" count={f.sharedNetworks.length}
                help="10 votes gratuits ou plus depuis une même connexion. Les opérateurs mobiles partagent souvent leurs adresses : ce n’est pas une preuve.">
                <Rows items={f.sharedNetworks.map(n => (
                    <span>Réseau <span className="font-mono">{n.network}</span> : {formatNumber(n.voters)} votants, pour {formatNumber(n.candidates)} {plural(n.candidates, 'candidat')}</span>
                ))} />
            </Block>

            <Block title="Beaucoup de votants sur un même appareil" count={f.sharedDevices.length} help="25 votes gratuits ou plus depuis un même type d’appareil et de navigateur.">
                <Rows items={f.sharedDevices.map(d => <span>Appareil <span className="font-mono">{d.device}</span> : {formatNumber(d.voters)} votants</span>)} />
            </Block>

            <Block title="Pics de votes gratuits" count={f.bursts.length} help="50 votes gratuits ou plus pour un candidat en 10 minutes (7 derniers jours).">
                <Rows items={f.bursts.map(b => (
                    <span>{cand(b)} : {formatNumber(b.votes)} votes à partir de {formatDateTime(b.at)}</span>
                ))} />
            </Block>
        </div>
    );
}
