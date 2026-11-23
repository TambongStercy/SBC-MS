/**
 * Asserts Security plan Phase 7 part 2 (réactivation campaign), user-service side:
 *   - the text: default draft, plain text only (no link, only {{nom}}), nothing sent before an
 *     approved version, approval numbers versions;
 *   - the audience: deleted/blocked, frozen, fraud-flagged, contacted < 30 days, unreachable
 *     (no usable email and no push) and allowlist (test mode) are left out, with counts;
 *   - sending: one member at a time, the approved text, counters; deferred (night / mail budget)
 *     waits without spending an attempt; notification-service down → retried, then failed
 *     with the 30 days given back; a member who came back meanwhile is skipped;
 *   - once per member per 30 days in the database: a second claim by another campaign fails;
 *   - one campaign at a time; cancel skips the rest and gives their 30 days back;
 *   - a sign-in within 30 days counts as a return.
 *
 * Needs local Mongo; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-dormancy-campaign.ts
 */
import mongoose, { Types } from 'mongoose';

const DB = process.env.DORMANCY_CAMPAIGN_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_dormancy_campaign_check';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check-secret';
process.env.DORMANCY_REACTIVATION_HOLD = 'log';
delete process.env.RISK_SERVICE_URL;
delete process.env.SUPPORT_SERVICE_URL;
delete process.env.REACTIVATION_SEND_MODE;
delete process.env.REACTIVATION_TEST_RECIPIENTS;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };
const DAY = 86_400_000;

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const m = await import('../database/models/dormancy.model');
    const { notificationService } = await import('../services/clients/notification.service.client');
    const cs = await import('../services/dormancy-campaign.service');

    // notification-service stand-in
    const sends: any[] = [];
    let mode: 'ok' | 'deferred' | 'down' | 'unreachable' = 'ok';
    let reach: { suppressedEmails: string[]; pushReachable: string[] } | null = { suppressedEmails: [], pushReachable: [] };
    (notificationService as any).sendReactivation = async (p: any) => {
        if (mode === 'down') throw new Error('ECONNREFUSED');
        if (mode === 'deferred') return { status: 'deferred', retryAt: new Date(Date.now() + 3_600_000).toISOString() };
        sends.push(p);
        if (mode === 'unreachable') return { status: 'done', email: 'suppressed', push: 'no_device' };
        return { status: 'done', email: p.email ? 'sent' : 'none', push: 'no_device' };
    };
    (notificationService as any).reactivationReach = async () => reach;

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([m.DormancyCampaignTargetModel.syncIndexes(), m.DormancyCampaignModel.syncIndexes()]);

    let n = 0;
    const mk = async (extra: Record<string, unknown> = {}, dormancy: Record<string, unknown> = {}) => {
        n += 1;
        const u = await UserModel.create({
            name: `Dormant ${n} Nom`, email: `dormant.${n}@gmail.com`, phoneNumber: `2376790${String(n).padStart(5, '0')}`, password: 'Secret123!',
            country: 'CM', referralCode: `DCAMP${n}`, balance: 10_000, ...extra,
        } as any);
        await UserModel.collection.updateOne({ _id: u._id }, { $set: { dormancy: { status: 'dormant', heldXaf: 10_000 - n, fraudFlag: false, ...dormancy } } });
        return u._id as Types.ObjectId;
    };

    // --- the text ---
    const t0 = await cs.getReactivationText();
    check('default draft offered, nothing approved yet', t0.isDefault && !t0.approved && /\{\{nom\}\}/.test(t0.draft.body));
    check('a link in the text is refused', (await refusal(() => cs.saveReactivationDraft({ ...cs.DEFAULT_TEXT, body: 'Allez sur https://evil.example' }, 'a1')))?.status === 400);
    check('a bare domain is refused too', (await refusal(() => cs.saveReactivationDraft({ ...cs.DEFAULT_TEXT, pushBody: 'Voir sbc-gain.com' }, 'a1')))?.status === 400);
    check('another placeholder is refused', (await refusal(() => cs.saveReactivationDraft({ ...cs.DEFAULT_TEXT, subject: '{{solde}} vous attend' }, 'a1')))?.status === 400);
    check('no campaign before an approved text (409)', (await refusal(() => cs.createCampaign({}, 'a1')))?.status === 409);
    await cs.saveReactivationDraft({ ...cs.DEFAULT_TEXT, subject: 'Bonjour {{nom}}' }, 'a1');
    const t1 = await cs.approveReactivationText('a2');
    check('approval: version 1, by whom, draft = approved', t1.approved?.version === 1 && t1.approved?.approvedBy === 'a2' && t1.draftApproved);
    await cs.saveReactivationDraft({ ...cs.DEFAULT_TEXT, subject: 'Autre objet' }, 'a1');
    const t2 = await cs.getReactivationText();
    check('an edited draft is not approved until approved again', !t2.draftApproved && t2.approved?.subject === 'Bonjour {{nom}}');

    // --- the audience ---
    const ok1 = await mk();
    const ok2 = await mk();
    const frozen = await mk({ frozen: { at: new Date(), reason: 'x' } });
    const fraud = await mk({}, { fraudFlag: true });
    const deleted = await mk({ blocked: true }); // deleted accounts never reach the list at all
    const recent = await mk();
    await m.DormancyContactModel.create({ _id: recent, lastAt: new Date(Date.now() - 10 * DAY), campaignId: new Types.ObjectId() });
    const unreachable = await mk({ email: 'gone@gmail.com' });
    await mk({}, { status: 'active' }); // not dormant: never matched
    reach = { suppressedEmails: ['gone@gmail.com'], pushReachable: [] };

    process.env.REACTIVATION_TEST_RECIPIENTS = `dormant.1@gmail.com`;
    let p = await cs.previewCampaign({});
    check('test mode (default): only the allowlist is sendable', p.mode === 'allowlist' && p.sendable === 1 && p.excluded.test_mode === 1, JSON.stringify(p));
    check('exclusions counted: frozen, fraud, inactive, recent contact, unreachable',
        p.matched === 7 && p.excluded.frozen === 1 && p.excluded.fraud === 1 && p.excluded.inactive === 1 && p.excluded.recent_contact === 1 && p.excluded.unreachable === 1,
        JSON.stringify(p.excluded));
    reach = null;
    p = await cs.previewCampaign({});
    check('notification-service unreachable: reach unknown, nobody dropped for it', !p.reachKnown && !p.excluded.unreachable);
    reach = { suppressedEmails: ['gone@gmail.com'], pushReachable: [] };

    process.env.REACTIVATION_SEND_MODE = 'live';
    p = await cs.previewCampaign({});
    check('live mode: every eligible member', p.mode === 'live' && p.sendable === 2 && p.withEmail === 2);

    // --- a campaign ---
    const c1 = await cs.createCampaign({}, 'a1');
    await cs.buildCampaign(c1.id); // create() starts it too; idempotent
    for (let i = 0; i < 20; i++) { if ((await m.DormancyCampaignModel.findById(c1.id).lean() as any)?.status !== 'building') break; await new Promise(r => setTimeout(r, 100)); }
    let c: any = await m.DormancyCampaignModel.findById(c1.id).lean();
    check('built: 2 targets, status sending, the approved text v1 copied', c.status === 'sending' && c.counts.targets === 2 && c.text.version === 1 && c.text.subject === 'Bonjour {{nom}}', JSON.stringify(c.counts));
    check('one campaign at a time (409)', (await refusal(() => cs.createCampaign({}, 'a1')))?.status === 409);
    check('a member once per campaign (unique index)',
        !!(await refusal(() => m.DormancyCampaignTargetModel.create({ campaignId: new Types.ObjectId(c1.id), userId: ok1 }))));

    // deferred first: nothing spent
    mode = 'deferred';
    let r = await cs.runCampaignSender();
    let t: any = await m.DormancyCampaignTargetModel.findOne({ campaignId: c1.id, status: 'pending' }).sort({ nextAt: 1 }).lean();
    c = await m.DormancyCampaignModel.findById(c1.id).lean();
    check('deferred: target stays pending, attempt not counted, campaign waits', r.processed === 1 && !!c.waitUntil && t && t.attempts === 0, JSON.stringify({ r, wait: c.waitUntil }));
    mode = 'ok';
    r = await cs.runCampaignSender();
    check('while waiting: no call at all', r.processed === 0 && sends.length === 0);
    await m.DormancyCampaignModel.updateOne({ _id: c1.id }, { $set: { waitUntil: null } });
    await m.DormancyCampaignTargetModel.updateMany({ campaignId: c1.id }, { $set: { nextAt: new Date(Date.now() - 1000) } });

    // ok2 comes back before its turn
    await UserModel.collection.updateOne({ _id: ok2 }, { $set: { 'dormancy.status': 'active' } });
    r = await cs.runCampaignSender();
    c = await m.DormancyCampaignModel.findById(c1.id).lean();
    const t1row: any = await m.DormancyCampaignTargetModel.findOne({ campaignId: c1.id, userId: ok1 }).lean();
    const t2row: any = await m.DormancyCampaignTargetModel.findOne({ campaignId: c1.id, userId: ok2 }).lean();
    check('sent with the approved text and the member’s address', sends.length === 1 && sends[0].userId === String(ok1) && sends[0].subject === 'Bonjour {{nom}}' && sends[0].email === 'dormant.1@gmail.com');
    check('target sent, counters, campaign done', t1row.status === 'sent' && c.counts.sent === 1 && c.counts.emailSent === 1 && c.status === 'done', JSON.stringify(c.counts));
    check('a member who came back meanwhile is skipped', t2row.status === 'skipped' && t2row.reason === 'returned');
    const contact: any = await m.DormancyContactModel.findById(ok1).lean();
    check('the 30-day contact is recorded', !!contact && String(contact.campaignId) === c1.id);
    check('another campaign cannot claim the member inside 30 days (database refuses)', !(await cs.claimContact(ok1, new Types.ObjectId(), new Date())));
    check('the same campaign re-claims (resume after a crash)', await cs.claimContact(ok1, new Types.ObjectId(c1.id), new Date()));
    check('after 30 days another campaign may', await cs.claimContact(ok1, new Types.ObjectId(), new Date(Date.now() + 31 * DAY)));

    // --- the return ---
    await m.DormancyContactModel.updateOne({ _id: ok1 }, { $set: { lastAt: new Date(), campaignId: new Types.ObjectId(c1.id) } });
    await cs.noteCampaignReturn(String(ok1));
    await cs.noteCampaignReturn(String(ok1));
    c = await m.DormancyCampaignModel.findById(c1.id).lean();
    check('a sign-in within 30 days counts as a return, once', c.counts.returned === 1);

    // --- failure path + cancel ---
    const more = [await mk(), await mk(), await mk()];
    const c2 = await cs.createCampaign({}, 'a1');
    for (let i = 0; i < 20; i++) { if ((await m.DormancyCampaignModel.findById(c2.id).lean() as any)?.status !== 'building') break; await new Promise(r2 => setTimeout(r2, 100)); }
    c = await m.DormancyCampaignModel.findById(c2.id).lean();
    check('second campaign leaves out the members contacted 30 days ago', c.counts.targets === 3 && (c.excluded.recent_contact ?? 0) >= 2, JSON.stringify(c.excluded));
    mode = 'down';
    for (let i = 0; i < 5; i++) {
        await m.DormancyCampaignTargetModel.updateMany({ campaignId: c2.id, status: 'pending' }, { $set: { nextAt: new Date(Date.now() - 1000) } });
        await cs.runCampaignSender();
    }
    const failed: any[] = await m.DormancyCampaignTargetModel.find({ campaignId: c2.id, status: 'failed' }).lean();
    check('notification-service down 5 times: that member failed, 30 days given back',
        failed.length === 1 && !(await m.DormancyContactModel.exists({ _id: failed[0].userId, campaignId: new Types.ObjectId(c2.id) })));
    mode = 'unreachable';
    await m.DormancyCampaignTargetModel.updateMany({ campaignId: c2.id, status: 'pending' }, { $set: { nextAt: new Date(Date.now() - 1000) } });
    await m.DormancyCampaignModel.updateOne({ _id: c2.id }, { $set: { waitUntil: null } });
    // one more member reached nothing (suppressed + no device): skipped, not counted as sent
    await cs.runCampaignSender();
    const unr: any = await m.DormancyCampaignTargetModel.findOne({ campaignId: c2.id, reason: 'unreachable' }).lean();
    check('nothing could reach a member: skipped as unreachable, 30 days given back',
        !!unr && !(await m.DormancyContactModel.exists({ _id: unr.userId, campaignId: new Types.ObjectId(c2.id) })));
    void more; void frozen; void fraud; void deleted; void unreachable;

    // cancel a fresh one with everyone pending
    await m.DormancyContactModel.deleteMany({});
    await m.DormancyCampaignModel.updateMany({ status: { $in: ['building', 'sending'] } }, { $set: { status: 'done' } });
    const c3 = await cs.createCampaign({}, 'a1');
    for (let i = 0; i < 20; i++) { if ((await m.DormancyCampaignModel.findById(c3.id).lean() as any)?.status !== 'building') break; await new Promise(r3 => setTimeout(r3, 100)); }
    const firstPending: any = await m.DormancyCampaignTargetModel.findOne({ campaignId: c3.id, status: 'pending' }).lean();
    await cs.claimContact(firstPending.userId, new Types.ObjectId(c3.id), new Date()); // claimed, then deferred
    const cancel = await cs.cancelCampaign(c3.id, 'a3');
    c = await m.DormancyCampaignModel.findById(c3.id).lean();
    check('cancel: the rest skipped, claimed contacts given back',
        cancel.notSent > 0 && c.status === 'cancelled' && !(await m.DormancyCampaignTargetModel.exists({ campaignId: c3.id, status: 'pending' }))
        && !(await m.DormancyContactModel.exists({ _id: firstPending.userId })));
    check('cancelling twice is refused (409)', (await refusal(() => cs.cancelCampaign(c3.id, 'a3')))?.status === 409);
    const list = await cs.listCampaigns();
    check('history lists every campaign, newest first, with counters', list.length === 3 && list[0].id === c3.id && typeof list[2].counts.returned === 'number');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
