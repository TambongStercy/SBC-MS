/**
 * Normalises `users.country` to ISO-2 upper case (admin plan, phase 3).
 *
 * Most rows already hold a code ("CM"); older ones hold a name in any case
 * ("Congo-Brazzaville", "Cameroun", "Bénin") or nothing. Each row that is not
 * already an upper-case two-letter code gets the code `determineUserCountryCode`
 * gives for (country, phoneNumber):
 *   - a known name or code (any case) → its code;
 *   - any other two-letter value → upper-cased;
 *   - empty/unknown → derived from the phone's dialling code (African codes only);
 *   - still nothing ("Autres") → left as it is, and listed.
 *
 * The admin filters already match every spelling (utils/country-filter.ts), so
 * this is a clean-up, not a prerequisite.
 *
 * Dry run by default; --apply writes. Each write is guarded on the value read,
 * so a row changed meanwhile is skipped. Safe to re-run.
 *
 *   npx ts-node --swc src/scripts/normalize-user-countries.ts            # dry run
 *   npx ts-node --swc src/scripts/normalize-user-countries.ts --apply
 */
import mongoose from 'mongoose';
import config from '../config';
import UserModel from '../database/models/user.model';
import { determineUserCountryCode } from '../utils/phone.utils';
import { isoOfCountryValue } from '../utils/country-filter';

const apply = process.argv.includes('--apply');
const ISO = /^[A-Z]{2}$/;
const label = (v: unknown) => (v === null || v === undefined ? '(none)' : v === '' ? '(empty)' : String(v));

async function distribution(): Promise<{ iso: number; other: Map<string, number> }> {
    const rows = await UserModel.collection
        .aggregate<{ _id: unknown; n: number }>([{ $group: { _id: '$country', n: { $sum: 1 } } }])
        .toArray();
    let iso = 0;
    const other = new Map<string, number>();
    for (const r of rows) {
        if (typeof r._id === 'string' && ISO.test(r._id)) iso += r.n;
        else other.set(label(r._id), r.n);
    }
    return { iso, other };
}

function print(title: string, d: { iso: number; other: Map<string, number> }) {
    const otherTotal = [...d.other.values()].reduce((a, b) => a + b, 0);
    console.log(`\n${title}: ${d.iso} ISO-2 upper case, ${otherTotal} other`);
    for (const [v, n] of [...d.other.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(28)} ${n}`);
}

async function main() {
    await mongoose.connect(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`Database: ${mongoose.connection.name}${apply ? '' : '  (dry run: nothing is written)'}`);

    const before = await distribution();
    print('Before', before);

    // Raw collection: deleted members are normalised too (the soft-delete hook would hide them).
    const cursor = UserModel.collection.find(
        { $or: [{ country: { $not: ISO } }, { country: { $exists: false } }] },
        { projection: { country: 1, phoneNumber: 1 } },
    );

    const changes = new Map<string, number>(); // "from → to" → count
    const unresolved = new Map<string, number>();
    let ops: any[] = [];
    let planned = 0;
    let written = 0;

    const flush = async () => {
        if (!ops.length) return;
        if (apply) written += (await UserModel.collection.bulkWrite(ops, { ordered: false })).modifiedCount;
        ops = [];
    };

    for await (const u of cursor) {
        const current = u.country as unknown;
        const target = isoOfCountryValue(current)
            ?? (() => {
                const code = determineUserCountryCode(typeof current === 'string' ? current : undefined, u.phoneNumber);
                return code === 'Autres' ? null : code;
            })();
        if (!target) {
            unresolved.set(label(current), (unresolved.get(label(current)) ?? 0) + 1);
            continue;
        }
        if (target === current) continue;
        const key = `${label(current)} → ${target}`;
        changes.set(key, (changes.get(key) ?? 0) + 1);
        planned++;
        ops.push({
            updateOne: {
                // Guarded on the value read: a row edited meanwhile is left alone.
                filter: { _id: u._id, country: current === undefined ? { $exists: false } : current },
                update: { $set: { country: target } },
            },
        });
        if (ops.length >= 1000) await flush();
    }
    await flush();

    console.log(`\nPlanned changes (${planned}):`);
    for (const [k, n] of [...changes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(36)} ${n}`);
    console.log(`\nLeft as is, no country could be derived (${[...unresolved.values()].reduce((a, b) => a + b, 0)}):`);
    for (const [k, n] of [...unresolved.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);

    if (apply) {
        console.log(`\nWritten: ${written}`);
        print('After', await distribution());
    } else {
        // Projected "after": the planned moves applied to the before counts.
        const after = { iso: before.iso + planned, other: new Map(before.other) };
        for (const [k, n] of changes) {
            const from = k.split(' → ')[0];
            const left = (after.other.get(from) ?? 0) - n;
            if (left > 0) after.other.set(from, left); else after.other.delete(from);
        }
        print('After (projected)', after);
        console.log('\nDry run. Re-run with --apply to write.');
    }
    await mongoose.disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect();
    process.exit(1);
});
