import mongoose from 'mongoose';
import fs from 'fs';
import { phoneLookupCandidates } from '../utils/phone.utils';
import { userRepository } from '../database/repositories/user.repository';

/**
 * Asserts the password-reset lookup finds members whatever format they type
 * their phone in. Until 2026-11-05 it matched the typed text exactly, and ~70%
 * of reset requests answered "user not found" (`+226 70000001` against the
 * stored `22670000001`).
 *
 *   npx ts-node src/scripts/check-reset-lookup.ts
 *
 * With CHECK_RESET_DB=<mongo uri> and CHECK_RESET_IDS=<file, one identifier per
 * line>, also replays those identifiers read-only and reports how many now
 * resolve to one account.
 */

let failures = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
};
const finds = (typed: string, stored: string) => check(`${JSON.stringify(typed)} reaches ${stored}`, phoneLookupCandidates(typed).includes(stored));

finds('+226 70000001', '22670000001');
finds('+237677000001', '237677000001');
finds('+243900000001', '2430900000001');
finds('0100000001', '2250100000001');
finds('677123456', '237677123456');
finds('237677123456', '677123456');
finds('+242 06 123 45 67', '242061234567');
finds('0700 0000 01 ', '2250700000001');
check('short input gives nothing', phoneLookupCandidates('1234').length === 0);
check('text gives nothing', phoneLookupCandidates('motdepasse!').length === 0);

const main = async () => {
    const uri = process.env.CHECK_RESET_DB;
    const file = process.env.CHECK_RESET_IDS;
    if (uri && file) {
        await mongoose.connect(uri);
        const ids = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        let found = 0;
        for (const id of ids) if (await userRepository.findByIdentifier(id)) found++;
        console.log(`\nreplay: ${found}/${ids.length} identifiers that were refused now resolve to one account`);
        await mongoose.disconnect();
    }
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
};
main().catch(err => { console.error(err); process.exit(1); });
