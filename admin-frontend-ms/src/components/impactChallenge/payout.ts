import { Entrepreneur, FundSummary, ImpactChallenge } from '../../services/impactChallengeApi';

export interface PayoutLeg {
    key: 'winner' | 'lottery' | 'commission';
    label: string;
    share: string;
    amount: number;
    transactionId?: string;
    state: 'paid' | 'due' | 'nothing';
}

/**
 * The three parts of a payout and where each one stands. The amounts are the
 * ones fixed at the first attempt when there was one (that is what a retry
 * pays), otherwise the preview from what has been collected.
 */
export const payoutLegs = (c: ImpactChallenge, summary: FundSummary | null, winner?: Entrepreneur): PayoutLeg[] => {
    const raw: Array<Omit<PayoutLeg, 'state'>> = [
        {
            key: 'winner',
            label: winner ? `Gagnant : ${winner.name}` : 'Gagnant',
            share: '50 %',
            amount: c.winnerPayoutAmount ?? summary?.winnerPayout ?? 0,
            transactionId: c.winnerTransactionId,
        },
        {
            key: 'lottery',
            label: 'Cagnotte de la tombola',
            share: '30 %',
            amount: c.lotteryPoolAmount ?? summary?.lotteryPool ?? 0,
            transactionId: c.lotteryTransactionId,
        },
        {
            key: 'commission',
            label: 'Commission SBC',
            share: '20 %',
            amount: c.commissionAmount ?? summary?.commission ?? 0,
            transactionId: c.commissionTransactionId,
        },
    ];
    return raw.map(l => ({
        ...l,
        state: l.transactionId ? 'paid' : l.amount <= 0 ? 'nothing' : c.fundsDistributed ? 'paid' : 'due',
    }));
};
