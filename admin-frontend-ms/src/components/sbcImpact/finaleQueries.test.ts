import { describe, expect, it } from 'vitest';
import { unmarkedFinalists } from './finaleQueries';

const finalists = [{ _id: 'fA', name: 'Awa' }, { _id: 'fB', name: 'Bello' }];
const juror = (ids: string[], removedAt: string | null = null) => ({ removedAt, scores: ids.map(candidateId => ({ candidateId })) });

describe('unmarkedFinalists (lock rule: every active juror marks every finalist)', () => {
    it('a finalist marked by one juror but not the other is still unmarked', () => {
        expect(unmarkedFinalists({ finalists, jurors: [juror(['fA', 'fB']), juror(['fA'])] }).map(f => f.name)).toEqual(['Bello']);
    });
    it('all marked by every active juror: nothing left; a removed juror does not count', () => {
        expect(unmarkedFinalists({ finalists, jurors: [juror(['fA', 'fB']), juror([], '2026-11-24T10:00:00Z')] })).toEqual([]);
    });
    it('no active juror: every finalist is unmarked', () => {
        expect(unmarkedFinalists({ finalists, jurors: [juror(['fA', 'fB'], '2026-11-24T10:00:00Z')] })).toHaveLength(2);
    });
});
