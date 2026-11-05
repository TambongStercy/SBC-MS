/**
 * The order a parrain's due relance targets go out in (interleaveJourneys).
 */
import { interleaveJourneys } from '../jobs/relance-journey-order';

describe('interleaveJourneys: a campaign is not starved by the relance-des-nouveaux backlog', () => {
    const at = (iso: string) => new Date(iso);
    const t = (id: string, campaignId: any, due: string) => ({ id, campaignId, nextMessageDue: at(due) });

    it('alternates journeys, each oldest due first', () => {
        const campaign = { _id: 'c1' };
        const targets = [
            t('d2', null, '2026-10-26T08:00Z'),
            t('d1', null, '2026-10-25T08:00Z'),
            t('d3', null, '2026-10-27T08:00Z'),
            t('c2', campaign, '2026-10-31T08:00Z'),
            t('c1', campaign, '2026-10-30T08:00Z'),
        ];
        expect(interleaveJourneys(targets).map((x: any) => x.id)).toEqual(['d1', 'c1', 'd2', 'c2', 'd3']);
    });

    it('keeps every target exactly once, with several campaigns', () => {
        const targets = [
            t('a', null, '2026-11-01T00:00Z'),
            t('b', 'c1', '2026-11-01T00:00Z'),
            t('c', 'c2', '2026-11-01T00:00Z'),
            t('d', 'c2', '2026-11-02T00:00Z'),
        ];
        const ids = interleaveJourneys(targets).map((x: any) => x.id);
        expect(ids).toEqual(['a', 'b', 'c', 'd']);
        expect(interleaveJourneys([])).toEqual([]);
    });
});
