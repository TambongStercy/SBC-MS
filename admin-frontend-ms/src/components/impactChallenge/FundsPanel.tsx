import React from 'react';
import { CheckCircle2, Circle, MinusCircle, RefreshCw, Wallet } from 'lucide-react';
import { Entrepreneur, FundSummary, ImpactChallenge, formatDateTime, formatXaf } from '../../services/impactChallengeApi';
import { PayoutLeg, payoutLegs } from './payout';
import { Notice } from './shared';
import { btn, panelClass } from './styles';

const LegState: React.FC<{ leg: PayoutLeg }> = ({ leg }) => {
    if (leg.state === 'paid') {
        return (
            <span className="inline-flex items-center gap-1 text-green-300 text-xs">
                <CheckCircle2 className="w-4 h-4" /> Versé
            </span>
        );
    }
    if (leg.state === 'nothing') {
        return (
            <span className="inline-flex items-center gap-1 text-gray-400 text-xs">
                <MinusCircle className="w-4 h-4" /> Rien à verser
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
            <Circle className="w-4 h-4" /> À verser
        </span>
    );
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

    return (
        <div className={`${panelClass} p-6 mb-6`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                        <Wallet className="w-5 h-5 text-green-400" />
                        {isDone ? 'Fonds distribués' : isClosed ? 'Distribution des fonds' : 'Répartition prévue'}
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                        {isDone
                            ? `Versé le ${formatDateTime(c.distributionDate)}, sur ${formatXaf(total)} collectés.`
                            : isClosed
                                ? `Sur ${formatXaf(total)} collectés pendant les votes.`
                                : `Calculée sur les ${formatXaf(total)} collectés jusqu’ici. Les montants sont fixés à la clôture des votes.`}
                    </p>
                </div>
                {isClosed && (
                    <div className="flex gap-2 shrink-0">
                        <button onClick={onRefresh} className={btn.secondary}><RefreshCw className="w-4 h-4" /> Rafraîchir</button>
                        <button onClick={onDistribute} disabled={blocked} className={btn.success}>
                            {c.distributionInProgress ? 'Versement en cours…' : partial ? 'Reprendre le versement' : 'Distribuer les fonds'}
                        </button>
                    </div>
                )}
            </div>

            {summaryError && !isDone && <Notice tone="danger" className="mb-4">{summaryError}</Notice>}

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/50 text-gray-300">
                        <tr>
                            <th className="px-4 py-2 text-left">Part</th>
                            <th className="px-4 py-2 text-left">Pourcentage</th>
                            <th className="px-4 py-2 text-right">Montant</th>
                            {(isClosed || isDone) && <th className="px-4 py-2 text-left">État</th>}
                            {(isClosed || isDone) && <th className="px-4 py-2 text-left">Transaction</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {legs.map(l => (
                            <tr key={l.key} className="border-t border-gray-700">
                                <td className="px-4 py-2 text-gray-200">{l.label}</td>
                                <td className="px-4 py-2 text-gray-400">{l.share}</td>
                                <td className="px-4 py-2 text-right text-white font-mono whitespace-nowrap">{formatXaf(l.amount)}</td>
                                {(isClosed || isDone) && <td className="px-4 py-2"><LegState leg={l} /></td>}
                                {(isClosed || isDone) && (
                                    <td className="px-4 py-2 font-mono text-xs text-gray-400 break-all">{l.transactionId || '—'}</td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isClosed && (
                <div className="space-y-3 mt-4">
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
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <span>
                                    {winner.name} n’a pas de compte SBC lié : sa part ne peut être créditée nulle part, le versement sera refusé.
                                </span>
                                <button onClick={() => onLinkWinner(winner)} className={`${btn.smallPrimary} shrink-0`}>Lier son compte SBC</button>
                            </div>
                        </Notice>
                    )}
                    {!blocked && (
                        <p className="text-xs text-gray-500">
                            La part du gagnant est créditée sur le solde de son compte SBC ; la cagnotte et la commission sur les comptes SBC prévus pour cela.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default FundsPanel;
