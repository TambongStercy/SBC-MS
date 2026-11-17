import { HugeiconsIcon } from '@hugeicons/react';
import { Badge } from '../ui';
import { withdrawalStatusIcon, withdrawalStatusLabel, withdrawalStatusTone } from './withdrawalStatus';

/** A withdrawal's state, in words with its icon. */
export function WithdrawalStatusBadge({ status }: { status: string }) {
    const icon = withdrawalStatusIcon(status);
    return (
        <Badge tone={withdrawalStatusTone(status)}>
            {icon && <HugeiconsIcon icon={icon} size={12} aria-hidden="true" />}
            {withdrawalStatusLabel(status)}
        </Badge>
    );
}
