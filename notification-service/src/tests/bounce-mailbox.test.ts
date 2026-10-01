/**
 * Bounce reports from our own mail server.
 *
 * Since mail moved off SendGrid/SES, refusals come back as bounce emails to
 * noreply@ and nobody read them, so relance kept writing to addresses that do
 * not exist. These tests pin which bounces suppress an address — only the
 * ones that say the address itself is bad — and that a pass never loses or
 * double-counts mail.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
import mongoose from 'mongoose';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import { BounceMailbox, isHardBounce, parseDsn, processBounces } from '../services/bounce-mailbox.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_bounce_mailbox_test';

/** What Postfix sends back, CRLF line endings and all. */
const postfixBounce = (recipients: Array<{ email: string; status: string; action?: string; diag: string }>) => [
    'From: MAILER-DAEMON@mail.sniperbuisnesscenter.com (Mail Delivery System)',
    'Subject: Undelivered Mail Returned to Sender',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
    '',
    '--B1',
    'Content-Type: text/plain; charset=us-ascii',
    '',
    'This is the mail system at host mail.sniperbuisnesscenter.com.',
    '',
    '--B1',
    'Content-Description: Delivery report',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; mail.sniperbuisnesscenter.com',
    'Arrival-Date: Wed,  1 Oct 2026 08:00:00 +0000',
    '',
    ...recipients.flatMap(r => [
        `Final-Recipient: rfc822; ${r.email}`,
        `Original-Recipient: rfc822;${r.email}`,
        `Action: ${r.action ?? 'failed'}`,
        `Status: ${r.status}`,
        `Remote-MTA: dns; mx.example.com`,
        // Long diagnostics are folded at a space onto a continuation line.
        `Diagnostic-Code: smtp; ${r.diag.slice(0, r.diag.indexOf(' ', 20))}`,
        `    ${r.diag.slice(r.diag.indexOf(' ', 20) + 1)}`,
        '',
    ]),
    '--B1--',
    '',
].join('\r\n');

const unknownUser = { email: 'Ghost@Gmail.com', status: '5.1.1', diag: '550-5.1.1 The email account that you tried to reach does not exist.' };
const blockedUs = { email: 'real@yahoo.fr', status: '5.7.1', diag: '554 5.7.1 Message rejected due to sender reputation' };

describe('reading a bounce report', () => {
    it('reads every recipient, lower-casing the address and unfolding the diagnostic', () => {
        const got = parseDsn(postfixBounce([unknownUser, blockedUs]));
        expect(got).toEqual([
            { email: 'ghost@gmail.com', action: 'failed', status: '5.1.1', diagnostic: `smtp; ${unknownUser.diag}` },
            { email: 'real@yahoo.fr', action: 'failed', status: '5.7.1', diagnostic: `smtp; ${blockedUs.diag}` },
        ]);
    });

    it('ignores mail that is not a delivery report — an auto-reply, say', () => {
        expect(parseDsn('From: someone@x.com\r\nSubject: Absent du bureau\r\n\r\nJe suis absent.')).toEqual([]);
    });

    it.each([
        ['5.1.1', 'failed', true],   // no such user
        ['5.1.10', 'failed', true],  // recipient address rejected (null MX)
        ['5.2.1', 'failed', true],   // mailbox disabled
        ['5.4.4', 'failed', true],   // domain cannot be routed
        ['5.7.1', 'failed', false],  // they blocked US — the person is real
        ['5.2.2', 'failed', false],  // mailbox full — try again another day
        ['4.4.1', 'delayed', false], // still trying
    ])('status %s (%s) suppresses the address: %s', (status, action, hard) => {
        expect(isHardBounce({ email: 'a@b.c', status, action })).toBe(hard);
    });
});

describe('a pass over the mailbox', () => {
    beforeAll(async () => {
        await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
        await mongoose.connection.dropDatabase();
        await RelanceBounceSuppressionModel.syncIndexes();
    });
    afterAll(async () => {
        await mongoose.connection.dropDatabase().catch(() => undefined);
        await mongoose.disconnect();
    });
    beforeEach(() => RelanceBounceSuppressionModel.deleteMany({}));

    const fakeMailbox = (sources: string[]) => {
        const read: number[] = [];
        const mailbox: BounceMailbox = {
            unreadBounces: async () => sources.map((source, i) => ({ uid: i + 1, source })).filter(m => !read.includes(m.uid)),
            markRead: async uids => { read.push(...uids); },
        };
        return { mailbox, read };
    };

    it('suppresses addresses that do not exist, keeps the ones that blocked us, and marks everything read', async () => {
        const { mailbox, read } = fakeMailbox([postfixBounce([unknownUser, blockedUs]), 'From: x\r\n\r\nnot a report']);

        expect(await processBounces(mailbox)).toEqual({ read: 2, suppressed: 1, ignored: 1 });

        const list = await RelanceBounceSuppressionModel.find().lean();
        expect(list.map(e => [e.email, e.source])).toEqual([['ghost@gmail.com', 'smtp_dsn']]);
        expect(list[0].reason).toMatch(/^5\.1\.1 smtp; 550-5\.1\.1/);
        expect(read).toEqual([1, 2]);
    });

    it('does not count an address twice when it bounces again', async () => {
        await processBounces(fakeMailbox([postfixBounce([unknownUser])]).mailbox);
        const again = await processBounces(fakeMailbox([postfixBounce([unknownUser])]).mailbox);
        expect(again.suppressed).toBe(0);
        expect(await RelanceBounceSuppressionModel.countDocuments()).toBe(1);
    });

    it('does nothing to the mailbox when there is nothing to read', async () => {
        const markRead = jest.fn();
        expect(await processBounces({ unreadBounces: async () => [], markRead })).toEqual({ read: 0, suppressed: 0, ignored: 0 });
        expect(markRead).not.toHaveBeenCalled();
    });
});
