import { useQuery } from '@tanstack/react-query';
import { listCandidates, type CandidateRow } from '../../services/impactV2Api';

export type CandidateIndex = Map<string, CandidateRow>;

/**
 * Every seat holder of the edition, by id. The votes, anomalies and the frozen
 * TOP 3 answers carry candidate ids only. The list comes seats first (arrival
 * order) and seats are at most 200, so reading pages until the first candidate
 * without a seat gets them all.
 */
export async function loadCandidateIndex(editionId: string): Promise<CandidateIndex> {
    const index: CandidateIndex = new Map();
    for (let page = 1; page <= 3; page++) {
        const res = await listCandidates(editionId, { page, limit: 100 });
        let done = res.items.length < 100;
        for (const c of res.items) {
            if (!c.seatNumber) { done = true; break; }
            index.set(c._id, c);
        }
        if (done) break;
    }
    return index;
}

export function useCandidateIndex(editionId: string, enabled = true) {
    return useQuery({
        queryKey: ['sbc-impact', 'candidate-index', editionId],
        queryFn: () => loadCandidateIndex(editionId),
        enabled,
        staleTime: 60_000,
    });
}

/** "Awa (n° 3)", or a short id when the candidate is unknown. */
export const candidateName = (index: CandidateIndex | undefined, id: string) => {
    const c = index?.get(id);
    return c ? `${c.profile.name}${c.seatNumber ? ` (n° ${c.seatNumber})` : ''}` : `…${id.slice(-6)}`;
};
