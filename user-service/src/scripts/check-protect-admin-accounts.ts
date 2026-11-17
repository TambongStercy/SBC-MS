/**
 * Checks protect-admin-accounts.middleware.ts without a database: only a super
 * admin may change an admin-team account. Run: npx ts-node --swc src/scripts/check-protect-admin-accounts.ts
 */
import UserModel from '../database/models/user.model';
import { protectAdminAccounts } from '../api/middleware/protect-admin-accounts.middleware';

const ids = { admin: '64b000000000000000000001', staff: '64b000000000000000000002', member: '64b000000000000000000003', mod: '64b000000000000000000004' };
const roles: Record<string, string> = { [ids.admin]: 'admin', [ids.staff]: 'staff', [ids.member]: 'user', [ids.mod]: 'moderator' };
(UserModel.collection as any).findOne = async (q: any) => {
    const r = roles[String(q._id)];
    return r ? { _id: q._id, role: r } : null;
};

async function run(callerRole: string, target: string, from: 'params' | 'body' = 'params'): Promise<number> {
    let status = 200;
    const req: any = { user: { role: callerRole, userId: ids.staff }, params: from === 'params' ? { userId: target } : {}, body: from === 'body' ? { userId: target } : {}, method: 'PUT', originalUrl: '/x' };
    const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
    await protectAdminAccounts(from)(req, res, () => { status = 200; });
    return status;
}

const cases: [string, string, 'params' | 'body', number][] = [
    ['staff', ids.admin, 'params', 403],
    ['staff', ids.staff, 'params', 403],
    ['staff', ids.mod, 'params', 403],
    ['staff', ids.member, 'params', 200],
    ['staff', ids.admin, 'body', 403],
    ['staff', ids.member, 'body', 200],
    ['admin', ids.admin, 'params', 200],
    ['admin', ids.staff, 'params', 200],
    ['withdrawal_admin', ids.admin, 'params', 403],
    ['staff', 'not-an-id', 'params', 200], // left to the handler's 400
];

(async () => {
    let failed = 0;
    for (const [caller, target, from, want] of cases) {
        const got = await run(caller, target, from);
        const ok = got === want;
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${caller} -> ${roles[target] ?? target} (${from}): ${got}, expected ${want}`);
    }
    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
})();
