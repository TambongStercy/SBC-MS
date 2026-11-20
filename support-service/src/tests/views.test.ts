import { Types } from 'mongoose';
import { ViewTask } from '../database/models/view-task.model';
import { claimNextTask, upsertViewTask } from '../services/views.service';
import { makeAgent, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

async function seedTasks(n: number) {
    for (let i = 0; i < n; i++) {
        await upsertViewTask({ sourceId: `proof-${i}`, submittedAt: new Date(Date.now() - (n - i) * 1000).toISOString(), dayIndex: 1, country: 'CM' });
    }
}

describe('next task', () => {
    it('never gives the same task to two verifiers, and is idempotent per verifier (20 parallel claims)', async () => {
        await seedTasks(30);
        const a = await makeAgent(['verifier']);
        const b = await makeAgent(['verifier']);
        const claims = await Promise.all(Array.from({ length: 20 }, (_, i) => claimNextTask({ id: i % 2 ? a.id : b.id })));
        const byAgent: Record<string, Set<string>> = { [a.id]: new Set(), [b.id]: new Set() };
        claims.forEach((c, i) => byAgent[i % 2 ? a.id : b.id].add(String((c.task as any)._id)));
        expect(byAgent[a.id].size).toBe(1);
        expect(byAgent[b.id].size).toBe(1);
        expect([...byAgent[a.id]][0]).not.toBe([...byAgent[b.id]][0]);
        expect(await ViewTask.countDocuments({ state: 'assigned' })).toBe(2);
    });

    it('hands 20 verifiers claiming at once 20 different tasks', async () => {
        await seedTasks(25);
        const agents = await Promise.all(Array.from({ length: 20 }, () => makeAgent(['verifier'])));
        const claims = await Promise.all(agents.map((ag) => claimNextTask({ id: ag.id })));
        const ids = claims.map((c) => String((c.task as any)._id));
        expect(new Set(ids).size).toBe(20);
        const assigned = await ViewTask.find({ state: 'assigned' }).lean();
        expect(assigned).toHaveLength(20);
        expect(new Set(assigned.map((t) => String(t.assigneeId))).size).toBe(20);
        // The oldest proofs went first.
        expect(new Set(assigned.map((t) => t.sourceId))).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `proof-${i}`)));
    });

    it('the database refuses two active assignments of the same proof', async () => {
        await seedTasks(1);
        const t = await ViewTask.findOne({}).lean();
        const dup = { ...t, _id: new Types.ObjectId(), state: 'assigned' };
        await ViewTask.updateOne({ _id: t!._id }, { $set: { state: 'in_progress' } });
        await expect(ViewTask.collection.insertOne(dup as any)).rejects.toMatchObject({ code: 11000 });
    });
});
