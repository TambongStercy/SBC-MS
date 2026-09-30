/**
 * Asserts an annonceur cannot silently buy an audience we do not have.
 *
 * Georgi, 2026-09-05: paid 6000 F for 2000 unique views targeting Gabon + RDC,
 * femmes 25-50. That matches 2 of 223 eligible diffuseurs. Nothing told him,
 * nothing told the admin about to validate it, and nothing stopped it — the
 * campaign would have gone live and sat at zero.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-reach.ts
 */
import mongoose, { Types } from 'mongoose';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import * as userClient from '../services/clients/user.service.client';

const DB = process.env.REACH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_reach_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

/** Country/sex/age are read off the user, so the stub is where the audience lives. */
const people = new Map<string, { country: string; sex: string; birthDate: string }>();
(userClient as any).getUserProfiles = async (ids: string[]) =>
    ids.map(id => ({
        _id: id, name: 'Test', city: 'x', region: 'x', language: ['fr'], interests: [], profession: 'x',
        ...(people.get(id) ?? { country: 'CM', sex: 'male', birthDate: '1995-01-01' }),
    }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { estimateReach, describeReach } = require('../services/reach.service');

let n = 0;
const diffuseur = async (country: string, sex: string, views: number, birthDate = '1995-01-01') => {
    const userId = new Types.ObjectId();
    people.set(String(userId), { country, sex, birthDate });
    await DiffuseurProfileModel.create({
        userId,
        declaredAverageViews: views,
        measuredAverageViews: views,
        hasCompletedTestCampaign: true,
        whatsappLid: `lid${n++}`,
    });
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // A pool shaped like the real one: mostly Cameroon, a couple in Gabon.
    for (let i = 0; i < 10; i++) await diffuseur('CM', 'male', 200);
    await diffuseur('GA', 'female', 150);
    await diffuseur('CD', 'female', 100);

    const wide = await estimateReach({ countries: ['CM'] }, 2000);
    check('a servable targeting reports enough reach', wide.sufficient === true,
        `${wide.matching} diffuseurs, ~${wide.projectedUniqueViews} views`);

    // Georgi's exact filters.
    const narrow = await estimateReach(
        { countries: ['GA', 'CD'], sex: ['female'], minAge: 25, maxAge: 50 },
        2000,
    );
    check('Georgi\'s targeting is reported as insufficient', narrow.sufficient === false,
        `${narrow.matching} diffuseurs, ~${narrow.projectedUniqueViews} of 2000 views`);
    check('and it says so in French the annonceur can act on',
        /moins que les 2000/.test(describeReach(narrow)), describeReach(narrow));

    const nobody = await estimateReach({ countries: ['FR'] }, 2000);
    check('targeting nobody is called out separately', nobody.matching === 0);
    check('with its own message', /Aucun diffuseur/.test(describeReach(nobody)), describeReach(nobody));

    // Without a target there is no verdict to give, only a count.
    const noTarget = await estimateReach({ countries: ['CM'] });
    check('no target asked for means no sufficiency verdict', noTarget.sufficient === undefined,
        `matching ${noTarget.matching}`);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err.message);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
