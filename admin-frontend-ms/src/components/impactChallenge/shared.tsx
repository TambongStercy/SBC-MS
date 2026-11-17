import type { ReactNode } from 'react';
import { Dialog, SheetContent } from '../ui';
import { StatusBadge as KitStatusBadge, type StatusMap } from '../moduleKit';
import { STATUS_LABELS, type ChallengeStatus } from '../../services/impactChallengeApi';

export { Notice } from '../moduleKit';

/** Challenge status in words, coloured by what it means (kit Badge, both themes). */
export const CHALLENGE_STATUS: StatusMap = {
    draft: [STATUS_LABELS.draft, 'neutral'],
    active: [STATUS_LABELS.active, 'success'],
    voting_closed: [STATUS_LABELS.voting_closed, 'warning'],
    funds_distributed: [STATUS_LABELS.funds_distributed, 'info'],
    cancelled: [STATUS_LABELS.cancelled, 'danger'],
};

export function StatusBadge({ status }: { status: ChallengeStatus }) {
    return <KitStatusBadge status={status} map={CHALLENGE_STATUS} />;
}

/**
 * A form in a side sheet (full screen on phones), with its buttons in a
 * footer that stays visible. Closing is blocked while it is saving or uploading.
 */
export function FormSheet({ title, description, onClose, busy = false, footer, children, wide = false }: {
    title: string;
    description?: ReactNode;
    onClose: () => void;
    busy?: boolean;
    footer: ReactNode;
    children: ReactNode;
    wide?: boolean;
}) {
    return (
        <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
            <SheetContent title={title} description={description} width={wide ? 'lg' : 'md'} footer={footer}>
                <div className="space-y-4">{children}</div>
            </SheetContent>
        </Dialog>
    );
}
