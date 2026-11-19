import { GUIDES } from '../config/guides';
import { memberGuides, saveGuidesFromDesk, toDesk } from '../services/guides.service';
import { setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const actions = (nodes: any[], out: string[] = []): string[] => {
    for (const n of nodes) { if (n.action) out.push(`${n.id}:${n.action}`); actions(n.children ?? [], out); }
    return out;
};

describe('guided paths', () => {
    it('a save from the desk editor keeps every member action, the self-service contact change included', async () => {
        expect(actions(GUIDES)).toContain('account-change-self:contact_change_self');
        await saveGuidesFromDesk(toDesk(GUIDES), 'agent-test');
        const saved = await memberGuides();
        expect(actions(saved.nodes)).toEqual(actions(GUIDES));
    });
});
