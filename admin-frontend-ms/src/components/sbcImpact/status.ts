import type { StatusMap } from '../moduleKit';
import {
    CANDIDATE_STATUS_LABELS as C, EDITION_STATUS_LABELS as E, PURCHASE_STATUS_LABELS as P, REVIEW_LABELS as R,
    ROUND_STATUS_LABELS as RS, SUBMISSION_STATUS_LABELS as S,
} from '../../services/impactV2Api';

/** Edition status in words, coloured by what it means. */
export const EDITION_STATUS: StatusMap = {
    DRAFT: [E.DRAFT, 'neutral'],
    QUALIFICATION: [E.QUALIFICATION, 'success'],
    QUALIFICATION_CLOSED: [E.QUALIFICATION_CLOSED, 'warning'],
    COMPETITION: [E.COMPETITION, 'primary'],
    FINAL: [E.FINAL, 'primary'],
    FINISHED: [E.FINISHED, 'info'],
    CANCELLED: [E.CANCELLED, 'danger'],
};

export const CANDIDATE_STATUS: StatusMap = {
    QUALIFYING: [C.QUALIFYING, 'neutral'],
    WAITLIST: [C.WAITLIST, 'info'],
    OFFICIAL: [C.OFFICIAL, 'success'],
    STAGE_2: [C.STAGE_2, 'primary'],
    STAGE_3: [C.STAGE_3, 'primary'],
    FINALIST: [C.FINALIST, 'primary'],
    WINNER: [C.WINNER, 'success'],
    ELIMINATED: [C.ELIMINATED, 'neutral'],
    FINISHED: [C.FINISHED, 'neutral'],
    NOT_SELECTED: [C.NOT_SELECTED, 'neutral'],
    SUSPENDED: [C.SUSPENDED, 'warning'],
    DISQUALIFIED: [C.DISQUALIFIED, 'danger'],
    WITHDRAWN: [C.WITHDRAWN, 'neutral'],
};

export const REVIEW_STATUS: StatusMap = {
    PENDING: [R.PENDING, 'warning'],
    APPROVED: [R.APPROVED, 'success'],
    CHANGES_REQUESTED: [R.CHANGES_REQUESTED, 'info'],
};

/**
 * Candidate list filters in the URL: ?statut=…&avis=…&sous=1&q=… (also set by
 * the page's metrics and to-do links). `sous=1`: seat holders below the requirement.
 */
export const CANDIDATE_FILTER_KEYS = ['statut', 'avis', 'sous', 'q'] as const;

export const ROUND_STATUS: StatusMap = {
    SCHEDULED: [RS.SCHEDULED, 'neutral'],
    OPEN: [RS.OPEN, 'success'],
    CLOSED: [RS.CLOSED, 'info'],
};

export const SUBMISSION_STATUS: StatusMap = {
    PENDING: [S.PENDING, 'warning'],
    ACCEPTED: [S.ACCEPTED, 'success'],
    REJECTED: [S.REJECTED, 'danger'],
    RESUBMIT_REQUESTED: [S.RESUBMIT_REQUESTED, 'info'],
};

export const PURCHASE_STATUS: StatusMap = {
    PENDING: [P.PENDING, 'neutral'],
    SUCCESS: [P.SUCCESS, 'success'],
    FAILED: [P.FAILED, 'danger'],
    CANCELLED: [P.CANCELLED, 'neutral'],
    REFUNDED: [P.REFUNDED, 'info'],
};
