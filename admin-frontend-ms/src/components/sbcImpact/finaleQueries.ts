import { useQuery } from '@tanstack/react-query';
import { getJury, getResult, type Edition } from '../../services/impactV2Api';

/** The jury and its marks; during the live (before the lock) it follows the jurors' marks every 15 s. */
export function useJury(edition: Edition) {
    const live = edition.stage === 'LIVE' && !edition.jury?.lockedAt;
    return useQuery({
        queryKey: ['sbc-impact', 'jury', edition._id],
        queryFn: () => getJury(edition._id),
        refetchInterval: live ? 15_000 : false,
    });
}

/** The result (computed live before publication, frozen after). */
export function useResult(edition: Edition, enabled = true) {
    return useQuery({
        queryKey: ['sbc-impact', 'result', edition._id],
        queryFn: () => getResult(edition._id),
        enabled,
    });
}

/** Finalists with no mark from any active juror (the lock needs one each). */
export function unmarkedFinalists(jury: { finalists: { _id: string; name: string }[]; jurors: { removedAt: string | null; scores: { candidateId: string }[] }[] }) {
    // Rufus (2026-11-24): every active juror must mark every finalist before the lock.
    const active = jury.jurors.filter(j => !j.removedAt);
    return jury.finalists.filter(f => active.length === 0 || active.some(j => !j.scores.some(s => s.candidateId === f._id)));
}
