import React from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { RecentWithdrawal } from '../../services/adminDashboardApi';
import { WithdrawalStatusBadge } from '../withdrawals/WithdrawalStatusBadge';
import { Button, EmptyState } from '../ui';
import { RelativeTime } from './DataStates';
import { formatMoney } from './format';

interface RecentWithdrawalsListProps {
    withdrawals: RecentWithdrawal[];
    /** Hide the "Voir tous les retraits" link (when the caller shows its own). */
    hideLink?: boolean;
}

/** Withdrawals waiting for the admin: member, amount, how long ago; link to the approval queue. */
const RecentWithdrawalsList: React.FC<RecentWithdrawalsListProps> = ({ withdrawals, hideLink }) => {
    if (withdrawals.length === 0) {
        return <EmptyState icon={CheckmarkCircle02Icon} title="Aucun retrait en attente" description="Tous les retraits ont été traités." className="py-8" />;
    }
    return (
        <div>
            <ul className="divide-y divide-line">
                {withdrawals.map(w => (
                    <li key={w._id} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">{w.userName || 'Membre inconnu'}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                                <RelativeTime value={w.createdAt} />
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">{w.transactionId?.slice(0, 12)}</span>
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-sm font-semibold text-fg tabular-nums">{formatMoney(w.amount, w.currency)}</span>
                            <WithdrawalStatusBadge status={w.status} />
                        </div>
                    </li>
                ))}
            </ul>
            {!hideLink && (
                <Button asChild variant="ghost" className="mt-2 h-11 w-full sm:h-9">
                    <Link to="/withdrawals/approvals">
                        Voir tous les retraits à valider
                        <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                    </Link>
                </Button>
            )}
        </div>
    );
};

export default RecentWithdrawalsList;
