/**
 * Re-reads the bounce reports of the last N days — read ones included — and
 * suppresses every dead address the current rule recognises.
 *
 * The reader marks reports read once handled, so when the rule widened
 * (2026-10-12: "mailbox not found" with 5.0.0, Gmail's "inactive" 5.2.2…) the
 * reports it had already skipped were never looked at again, and those
 * addresses kept bouncing. The mailbox is opened read-only: nothing is marked
 * or deleted.
 *
 *   npx ts-node src/scripts/rescan-bounces.ts                 # dry run, 30 days
 *   npx ts-node src/scripts/rescan-bounces.ts --days 60 --apply
 */
import mongoose from 'mongoose';
import { ImapFlow } from 'imapflow';
import config from '../config';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import { isHardBounce, parseDsn } from '../services/bounce-mailbox.service';

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 30;

(async () => {
    const b = config.email.bounceMailbox;
    const client = new ImapFlow({ host: b.host, port: b.port, secure: b.port === 993, auth: { user: b.user, pass: b.password }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    await mongoose.connect(config.mongodb.uri);

    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
    const uids = (await client.search({ since, or: [{ from: 'mailer-daemon' }, { header: { 'content-type': 'multipart/report' } }] }, { uid: true })) || [];
    const dead = new Map<string, string>();
    for await (const m of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        for (const r of parseDsn(m.source.toString('utf8'))) {
            if (isHardBounce(r)) dead.set(r.email, `${r.status} ${r.diagnostic ?? ''}`.trim().slice(0, 500));
        }
    }
    await client.logout();

    const already = new Set((await RelanceBounceSuppressionModel.find({ email: { $in: [...dead.keys()] } }, { email: 1 }).lean()).map((d: any) => d.email));
    const missing = [...dead].filter(([email]) => !already.has(email));
    console.log(`${uids.length} reports over ${DAYS} days: ${dead.size} dead addresses, ${already.size} already blocked, ${missing.length} to block`);

    if (APPLY && missing.length) {
        await RelanceBounceSuppressionModel.bulkWrite(missing.map(([email, reason]) => ({
            updateOne: {
                filter: { email },
                update: { $setOnInsert: { email, reason, bouncedAt: new Date(), source: 'smtp_dsn' } },
                upsert: true,
            },
        })));
        console.log(`Blocked ${missing.length}. The service picks them up within 5 minutes.`);
    } else if (!APPLY) {
        console.log('Dry run — add --apply to block them.');
    }
    await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
