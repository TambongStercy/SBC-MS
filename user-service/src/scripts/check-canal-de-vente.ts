/**
 * Checks services/canal-de-vente.service.ts without a database or canal
 * backend (both faked). Run: npx ts-node src/scripts/check-canal-de-vente.ts
 */
import UserModel from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import { ensureCanalLink } from '../services/canal-de-vente.service';
import config from '../config';

const SECRET = 'x'.repeat(64);
config.canalDeVente.secret = SECRET;

const ID = '64b000000000000000000001';
let user: any; let winner = true; let calls: any[] = []; let canal: { status: number; body: any } = { status: 200, body: {} };
const updates: any[] = [];
(UserModel as any).findOne = () => ({ select: () => ({ lean: async () => user }) });
(UserModel as any).updateOne = async (_q: any, u: any) => { updates.push(u); return {}; };
(SubscriptionModel as any).exists = async () => (winner ? { _id: 1 } : null);
(globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: canal.status < 300, status: canal.status, json: async () => canal.body };
};
const reset = (u: any) => { user = u; winner = true; calls = []; updates.length = 0; canal = { status: 200, body: { link: 'https://canaldevente.sniperbuisnesscenter.com/alice12/237690000001', created: true } }; };
const base = { _id: ID, name: 'Alice', referralCode: 'alice12', phoneNumber: '+237 690 000 001' };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); };

(async () => {
    reset({ ...base });
    let link = await ensureCanalLink(ID, { notify: true });
    check('Winner without link: creates it', link === canal.body.link && calls.length === 1);
    check('sends code and digits-only phone from the account', calls[0]?.body.code === 'alice12' && calls[0]?.body.phone === '237690000001' && calls[0]?.body.notify === true);
    check('sends the shared secret', calls[0]?.headers['X-Service-Secret'] === SECRET);
    check('saves the link', updates.some(u => u.$set?.['canalDeVente.link'] === canal.body.link));

    reset({ ...base, featuredWhatsappNumber: '237655555555' });
    await ensureCanalLink(ID);
    check('uses the featured WhatsApp number', calls[0]?.body.phone === '237655555555');

    reset({ ...base, canalDeVente: { link: 'https://canaldevente.sniperbuisnesscenter.com/alice12/237690000001' } });
    link = await ensureCanalLink(ID);
    check('already linked: no call', !!link && calls.length === 0);

    reset({ ...base }); winner = false;
    check('not Winner: no link, no call', (await ensureCanalLink(ID)) === null && calls.length === 0);

    reset({ ...base, blocked: true });
    check('blocked member: no call', (await ensureCanalLink(ID)) === null && calls.length === 0);

    reset({ ...base, canalDeVente: { lastAttemptAt: new Date() } });
    check('tried a minute ago: waits', (await ensureCanalLink(ID)) === null && calls.length === 0);
    reset({ ...base, canalDeVente: { lastAttemptAt: new Date() } });
    check('force ignores the wait', !!(await ensureCanalLink(ID, { force: true })) && calls.length === 1);

    reset({ ...base }); canal = { status: 500, body: { message: 'down' } };
    check('canal down: null, error saved', (await ensureCanalLink(ID)) === null && updates.some(u => u.$set?.['canalDeVente.lastError']));

    reset({ ...base }); canal = { status: 200, body: { link: 'https://evil.example.com/alice12/237690000001' } };
    check('link on another domain: refused', (await ensureCanalLink(ID)) === null && !updates.some(u => u.$set?.['canalDeVente.link']));

    reset({ ...base, referralCode: 'a b' });
    check('unusable code: no call', (await ensureCanalLink(ID)) === null && calls.length === 0);

    console.log(failed ? `${failed} failed` : 'all passed');
    process.exit(failed ? 1 : 0);
})();
