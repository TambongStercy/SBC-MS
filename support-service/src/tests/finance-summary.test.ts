import { presentFinanceSummary } from '../api/routes/desk/finance.routes';

describe('desk finance summary', () => {
    it('turns payment-service objects into the lists the agent app reads, every age bucket in order', () => {
        // payment-service shape (CONTRACT §2.2). The agent app crashed on it ("reading 'find'") before this.
        const out = presentFinanceSummary({
            currency: 'XAF',
            byBusinessStatus: { PENDING: { count: 2, amount: 9000 }, UNKNOWN: { count: 5, amount: 40000 } },
            openByAge: { '<24h': { count: 3, amount: 6000 }, '>72h': { count: 1, amount: 2500 } },
        });
        expect(out.byStatus).toEqual([{ status: 'UNKNOWN', count: 5, amount: 40000 }, { status: 'PENDING', count: 2, amount: 9000 }]);
        expect(out.ageBuckets.map((b) => [b.bucket, b.count])).toEqual([['<24h', 3], ['24-48h', 0], ['48-72h', 0], ['>72h', 1]]);
    });

    it('never fails on an empty or missing answer', () => {
        expect(presentFinanceSummary(null)).toEqual({ currency: 'XAF', byStatus: [], ageBuckets: expect.arrayContaining([{ bucket: '<24h', count: 0, amount: 0 }]) });
    });
});
