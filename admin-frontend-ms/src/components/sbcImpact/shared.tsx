import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { Avatar, Badge } from '../ui';
import { StatusBadge } from '../moduleKit';
import {
    photoUrl, type CandidateStatus, type EditionStatus, type PurchaseStatus, type ReviewStatus, type RoundStatus, type SubmissionStatus,
} from '../../services/impactV2Api';
import { CANDIDATE_STATUS, EDITION_STATUS, PURCHASE_STATUS, REVIEW_STATUS, ROUND_STATUS, SUBMISSION_STATUS } from './status';

export function EditionStatusBadge({ status }: { status: EditionStatus }) {
    return <StatusBadge status={status} map={EDITION_STATUS} />;
}

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
    return <StatusBadge status={status} map={CANDIDATE_STATUS} />;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
    return <StatusBadge status={status} map={REVIEW_STATUS} />;
}

export function RoundStatusBadge({ status }: { status: RoundStatus }) {
    return <StatusBadge status={status} map={ROUND_STATUS} />;
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
    return <StatusBadge status={status} map={SUBMISSION_STATUS} />;
}

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
    return <StatusBadge status={status} map={PURCHASE_STATUS} />;
}

/** A seat holder whose count fell back below the requirement (a reversed activation). */
export function BelowRequirementBadge() {
    return (
        <Badge tone="danger" title="Une activation de filleul a été annulée après l’attribution de la place. La place est gardée : à vous de décider.">
            <HugeiconsIcon icon={Alert02Icon} size={12} aria-hidden="true" />Sous le seuil
        </Badge>
    );
}

/** The candidate's photo as a small round thumbnail (initials when missing or broken). */
export function CandidateThumb({ fileId, name, size = 'md' }: { fileId?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
    const px = { sm: 64, md: 80, lg: 112 }[size];
    return <Avatar src={photoUrl(fileId, px) || null} name={name} size={size} />;
}

/** The candidate's photo, larger, opening the full-size file in a new tab. */
export function CandidatePhoto({ fileId, name }: { fileId?: string | null; name: string }) {
    const [broken, setBroken] = useState(false);
    if (!fileId || broken) {
        return (
            <div className="flex h-40 w-40 items-center justify-center rounded-panel border border-line bg-surface-2 text-sm text-fg-muted">
                {fileId ? 'Photo indisponible' : 'Pas de photo'}
            </div>
        );
    }
    return (
        <a href={photoUrl(fileId)} target="_blank" rel="noreferrer" className="inline-block" title="Ouvrir la photo en grand">
            <img
                src={photoUrl(fileId, 480)}
                alt={`Photo de ${name}`}
                onError={() => setBroken(true)}
                className="h-40 w-40 rounded-panel border border-line object-cover"
            />
        </a>
    );
}
