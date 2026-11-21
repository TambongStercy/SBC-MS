/**
 * Security plan Phase 5: fills `country` on tickets and cases opened before
 * country teams (from the member's declared country in user-service), and
 * `severityRank` on cases (the queues' order). Read-only by default.
 *
 *   node dist/scripts/backfill-country-teams.js            dry run: counts what would change
 *   node dist/scripts/backfill-country-teams.js --apply    writes
 *
 * Items with no member (public requests) or an unknown country stay null: only
 * agents without a country team see them. Safe to run again.
 */
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { closeRedis } from '../lib/redis';
import { Ticket } from '../database/models/ticket.model';
import { Case } from '../database/models/case.model';
import { memberCountry } from '../services/scope.service';

const RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

async function main() {
    const apply = process.argv.includes('--apply');
    await connectDB();
    let tickets = 0, ticketsFound = 0, cases = 0, casesFound = 0, ranks = 0;

    for await (const t of Ticket.find({ country: { $in: [null, undefined] }, memberId: { $ne: null } }, { memberId: 1 }).lean().cursor()) {
        tickets++;
        const c = await memberCountry(t.memberId);
        if (!c) continue;
        ticketsFound++;
        if (apply) await Ticket.updateOne({ _id: t._id, country: { $in: [null, undefined] } }, { $set: { country: c } });
    }
    for await (const k of Case.find({ country: { $in: [null, undefined] }, 'subject.userId': { $nin: [null, ''] } }, { subject: 1 }).lean().cursor()) {
        cases++;
        const c = await memberCountry(k.subject?.userId);
        if (!c) continue;
        casesFound++;
        if (apply) await Case.updateOne({ _id: k._id, country: { $in: [null, undefined] } }, { $set: { country: c } });
    }
    for (const [severity, rank] of Object.entries(RANK)) {
        const filter = { severity, severityRank: { $ne: rank } };
        const n = await Case.countDocuments(filter);
        ranks += n;
        if (apply && n) await Case.updateMany(filter, { $set: { severityRank: rank } });
    }
    process.stdout.write(`tickets without country: ${tickets} (country found for ${ticketsFound})\n`);
    process.stdout.write(`cases without country: ${cases} (country found for ${casesFound})\n`);
    process.stdout.write(`cases whose severity rank is missing or wrong: ${ranks}\n`);
    process.stdout.write(apply ? 'Written.\n' : 'Dry run: nothing written. Add --apply.\n');
    await mongoose.disconnect();
    await closeRedis();
}

main().then(() => process.exit(0)).catch((err) => { process.stderr.write(`${err?.stack || err}\n`); process.exit(1); });
