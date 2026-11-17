import React from 'react';
import { AccountTransaction } from '../../services/adminAccountTransactionApi';
import { ACCOUNT_STATUS, ACCOUNT_TYPE, PAYMENT_STATUS, StatusBadge, gatewayLabel } from '../finance/labels';
import { EmptyState } from '../ui';
import { cn } from '../../lib/cn';
import { RelativeTime } from './DataStates';
import { formatMoney } from './format';

interface RecentTransactionsListProps {
    /**
     * Account transactions, or payment intents (what GET /payments/admin/transactions
     * returns: upper-case statuses, a gateway, no type). Both are drawn.
     */
    transactions: AccountTransaction[];
}

type Row = AccountTransaction & { gateway?: string; paymentType?: string };

/** The last account transactions: who, what, when, and the amount (right-aligned, with its unit). */
const RecentTransactionsList: React.FC<RecentTransactionsListProps> = ({ transactions }) => {
    if (!transactions || transactions.length === 0) {
        return <EmptyState title="Aucune transaction sur cette période" className="py-8" />;
    }
    return (
        <ul className="divide-y divide-line">
            {(transactions as Row[]).map(tx => {
                const intent = !!tx.status && tx.status in PAYMENT_STATUS;
                const amount = Number(tx.amount) || 0;
                const outgoing = !intent && (tx.type === 'withdrawal' || tx.type === 'payment' || tx.type === 'fee' || amount < 0);
                const kind = intent ? `Paiement${tx.gateway ? ` · ${gatewayLabel(tx.gateway)}` : ''}` : (ACCOUNT_TYPE[tx.type] ?? tx.type);
                return (
                    <li key={tx._id} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">{tx.userName || `Membre ${String(tx.userId).slice(0, 6)}…`}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                                {kind && <><span>{kind}</span><span aria-hidden="true">·</span></>}
                                <RelativeTime value={tx.createdAt} />
                            </p>
                            {tx.description && <p className="mt-0.5 truncate text-xs text-fg-subtle">{tx.description}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className={cn('text-sm font-semibold tabular-nums', outgoing || (intent && String(tx.status) !== 'SUCCEEDED') ? 'text-fg' : 'text-success')}>
                                {outgoing ? '−' : '+'}{formatMoney(Math.abs(amount), tx.currency)}
                            </span>
                            {intent
                                ? <StatusBadge status={tx.status} map={PAYMENT_STATUS} />
                                : tx.status && tx.status !== 'completed' && <StatusBadge status={tx.status} map={ACCOUNT_STATUS} />}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};

export default RecentTransactionsList;
