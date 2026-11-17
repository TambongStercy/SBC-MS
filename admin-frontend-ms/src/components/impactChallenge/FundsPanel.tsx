import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon, Clock01Icon, MinusSignIcon, RefreshIcon } from '@hugeicons/core-free-icons';
import { Entrepreneur, FundSummary, ImpactChallenge } from '../../services/impactChallengeApi';
import { Badge, Button, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../ui';
import { Can } from '../Can';
import { Money, formatDateTime, formatMoney } from '../moduleKit';
import { PayoutLeg, payoutLegs } from './payout';
import { Notice } from './shared';

const LegState: React.FC<{ leg: PayoutLeg }> = ({ leg }) => {
    if (leg.state === 'paid') return <Badge tone="success"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} aria-hidden="true" />Versé</Badge>;
    if (leg.state === 'nothing') return <Badge tone="neutral"><HugeiconsIcon icon={MinusSignIcon} size={12} aria-hidden="true" />Rien à verser</Badge>;
    return <Badge tone="warning"><HugeiconsIcon icon={Clock01Icon} size={12} aria-hidden="true" />À verser</Badge>;
};

/**
 * Where the money goes: preview while votes are open, the payout once they are
 * closed (with a retry when it stopped part-way), and what was paid after.
 */
const FundsPanel: React.FC<{
    challenge: ImpactChallenge;
    summary: FundSummary | null;
    summaryError: string | null;
    winner?: Entrepreneur;
    onDistribute: () => void;
    onLinkWinner: (e: Entrepreneur) => void;
    onRefresh: () => void;
}> = ({ challenge: c, summary, summaryError, winner, onDistribute, onLinkWinner, onRefresh }) => {
    const legs = payoutLegs(c, summary, winner);
    const isClosed = c.status === 'voting_closed';
    const isDone = c.status === 'funds_distributed';
    const partial = isClosed && legs.some(l => l.state === 'paid');
    const total = summary?.totalCollected ?? c.totalCollected;
    const winnerMissingAccount = isClosed && !!winner && !winner.userId;
    const noWinner = isClosed && !winner;
    const blocked = c.distributionInProgress || noWinner || winnerMissingAccount;
    const withState = isClosed || isDone;

    const columns: ListColumn<PayoutLeg>[] = [
        { key: 'label', header: 'Part', cell: l => <span className="text-fg">{l.label} <span className="text-fg-muted">· {l.share}</span></span> },
        { key: 'amount', header: 'Montant', numeric: true, cell: l => <Money value={l.amount} /> },
        ...(withState ? [
            { key: 'state', header: 'État', cell: (l: PayoutLeg) => <LegState leg={l} /> },
            { key: 'tx', header: 'Transaction', cell: (l: PayoutLeg) => <span className="break-all font-mono text-xs text-fg-muted">{l.transactionId || '—'}</span> },
        ] : []),
    ];

    return (
        <Panel>
            <PanelHeader
                title={isDone ? 'Fonds distribués' : isClosed ? 'Distribution des fonds' : 'Répartition prévue'}
                description={isDone
                    ? `Versé le ${formatDateTime(c.distributionDate)}, sur ${formatMoney(total)} collectés.`
                    : isClosed
                        ? `Sur ${formatMoney(total)} collectés pendant les votes.`
                        : `Calculée sur les ${formatMoney(total)} collectés jusqu’ici. Les montants sont fixés à la clôture des votes.`}
                actions={isClosed ? (
                    <div className="hidden items-center gap-2 sm:flex">
                        <Button variant="ghost" size="md" onClick={onRefresh}><HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Rafraîchir</Button>
                        <Can module="impactChallenge" write>
                            <Button variant="primary" size="md" onClick={onDistribute} disabled={blocked}>
                                {c.distributionInProgress ? 'Versement en cours…' : partial ? 'Reprendre le versement' : 'Distribuer les fonds'}
                            </Button>
                        </Can>
                    </div>
                ) : undefined}
            />
            {isClosed && (
                <div className="grid grid-cols-1 gap-2 px-4 pb-3 sm:hidden">
                    <Can module="impactChallenge" write>
                        <Button variant="primary" size="lg" onClick={onDistribute} disabled={blocked}>
                            {c.distributionInProgress ? 'Versement en cours…' : partial ? 'Reprendre le versement' : 'Distribuer les fonds'}
                        </Button>
                    </Can>
                    <Button variant="outline" size="lg" onClick={onRefresh}>Rafraîchir</Button>
                </div>
            )}

            {summaryError && !isDone && <div className="px-4 pb-3 sm:px-5"><Notice tone="danger">{summaryError}</Notice></div>}

            <ResponsiveList rows={legs} columns={columns} rowKey={l => l.key} className="border-t border-line" />

            {isClosed && (
                <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
                    {c.distributionInProgress && (
                        <Notice tone="info">
                            Un versement est en cours. Rafraîchis dans un instant pour voir le résultat.
                            S’il reste affiché longtemps, le versement a été interrompu côté serveur : préviens l’équipe technique avant de réessayer.
                        </Notice>
                    )}
                    {partial && !c.distributionInProgress && (
                        <Notice tone="warning">
                            Le versement s’est arrêté en cours de route. Les parts marquées « Versé » sont enregistrées et ne seront pas payées deux fois :
                            « Reprendre le versement » paie seulement les parts « À verser », avec les mêmes montants.
                        </Notice>
                    )}
                    {noWinner && (
                        <Notice tone="danger">
                            Aucun gagnant n’a été désigné (aucun entrepreneur approuvé au moment de la clôture) : le versement sera refusé.
                        </Notice>
                    )}
                    {winnerMissingAccount && winner && (
                        <Notice tone="danger">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <span>{winner.name} n’a pas de compte SBC lié : sa part ne peut être créditée nulle part, le versement sera refusé.</span>
                                <Can module="impactChallenge" write>
                                    <Button variant="soft" size="md" className="h-11 shrink-0 sm:h-9" onClick={() => onLinkWinner(winner)}>Lier son compte SBC</Button>
                                </Can>
                            </div>
                        </Notice>
                    )}
                    {!blocked && (
                        <p className="text-xs text-fg-muted">
                            La part du gagnant est créditée sur le solde de son compte SBC ; la cagnotte et la commission sur les comptes SBC prévus pour cela.
                            Le versement demande LOTTERY_POOL_ACCOUNT_ID et SBC_COMMISSION_ACCOUNT_ID dans la configuration du serveur tombola.
                        </p>
                    )}
                </div>
            )}
        </Panel>
    );
};

export default FundsPanel;
