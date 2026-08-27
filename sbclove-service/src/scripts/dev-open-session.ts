/**
 * Dev-only: make SBC Love testable right now.
 *
 *  1. opens the weekly window for today, all day (spec §2 config, DB singleton);
 *  2. approves your own profile so you can express interest;
 *  3. seeds three approved profiles to browse, one of which already likes you —
 *     so a reciprocal interest turns into a real match.
 *
 * Run:   npx ts-node src/scripts/dev-open-session.ts [yourUserId]
 * Undo:  npx ts-node src/scripts/dev-open-session.ts --reset
 *
 * Without a userId it picks the most recently created profile — yours, if you
 * just made it in the browser. Refuses to run against NODE_ENV=production.
 */
import mongoose, { Types } from 'mongoose';
import connectDB from '../database/connection';
import config from '../config';
import LoveProfileModel from '../database/models/love-profile.model';
import InterestModel from '../database/models/interest.model';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import { getSessionDateKey } from '../utils/sbcloveWindow';
import { Intention, ProfileStatus } from '../types/sbclove.enums';

const SEED_TAG = '[dev-seed]'; // marks the throwaway profiles so --reset can find them

const SEEDS = [
    { name: 'Awa', intention: Intention.SERIOUS_RELATIONSHIP, description: 'Profil de test — je cherche une relation sérieuse.', likesYou: true, sex: 'female', city: 'Douala', birthDate: '1996-04-12' },
    { name: 'Bertrand', intention: Intention.GET_ACQUAINTED, description: 'Profil de test — faire connaissance, sans pression.', likesYou: false, sex: 'male', city: 'Yaoundé', birthDate: '1990-09-03' },
    { name: 'Clarisse', intention: Intention.MARRIAGE_PROJECT, description: 'Profil de test — projet de mariage à moyen terme.', likesYou: false, sex: 'female', city: 'Bafoussam', birthDate: '1993-01-25' },
    { name: 'Nadège', intention: Intention.EXPAND_SOCIAL_CIRCLE, description: 'Profil de test — élargir mon cercle social.', likesYou: false, sex: 'female', city: 'Kribi', birthDate: '1998-07-08' },
    { name: 'Sonia', intention: Intention.VALUES_RESPECT_EXCHANGE, description: 'Profil de test — échange basé sur les valeurs.', likesYou: false, sex: 'female', city: 'Douala', birthDate: '1991-11-30' },
];

// A LoveProfile alone is not enough: user-service is the source of truth for
// name/sex/city/age, and chat-service falls back to "Unknown User" without a
// record — so each seed needs an SBC account too.
const USERS_DB = 'mongodb://127.0.0.1:27017/sbc_user_dev';

/** Today's weekday in the module timezone — the window is per-weekday. */
function todayWeekday(): number {
    const short = new Intl.DateTimeFormat('en-US', { timeZone: config.sbclove.timezone, weekday: 'short' }).format(new Date());
    return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[short];
}

async function main() {
    if (config.nodeEnv === 'production') throw new Error('Refusing to run in production.');
    await connectDB();

    const users = await mongoose.createConnection(USERS_DB).asPromise();

    if (process.argv.includes('--reset')) {
        const seeded = await LoveProfileModel.find({ displayName: new RegExp(SEED_TAG.replace(/[[\]]/g, '\\$&')) }).exec();
        const ids = seeded.map(p => p.userId);
        await InterestModel.deleteMany({ $or: [{ fromUserId: { $in: ids } }, { toUserId: { $in: ids } }] });
        await LoveProfileModel.deleteMany({ _id: { $in: seeded.map(p => p._id) } });
        await users.collection('users').deleteMany({ _id: { $in: ids } });
        await moduleConfigRepository.update({ activeWeekday: 3, openHour: 18, closeHour: 21 } as any, 'dev-script');
        console.log(`removed ${seeded.length} seeded profile(s); window restored to Wednesday 18h–21h`);
        return;
    }

    // 1. Window open today, all day.
    const weekday = todayWeekday();
    const cfg = await moduleConfigRepository.update({ enabled: true, activeWeekday: weekday, openHour: 0, closeHour: 24 } as any, 'dev-script');
    console.log(`window: weekday=${weekday} ${cfg.openHour}h–${cfg.closeHour}h (${cfg.timezone}) — open now`);

    // 2. Your profile: approved, so the interest button is live.
    const mine = process.argv[2] && !process.argv[2].startsWith('--')
        ? await LoveProfileModel.findOne({ userId: new Types.ObjectId(process.argv[2]) }).exec()
        : await LoveProfileModel.findOne({ displayName: { $not: new RegExp(SEED_TAG.replace(/[[\]]/g, '\\$&')) } }).sort({ createdAt: -1 }).exec();

    if (!mine) {
        console.log('no profile found — create yours in the app first, then re-run.');
        return;
    }
    await LoveProfileModel.updateOne({ _id: mine._id }, { status: ProfileStatus.APPROVED, 'moderation.validatedAt': new Date() });
    console.log(`approved your profile ${mine._id} (user ${mine.userId})`);

    // 3. Profiles to browse; the first one already expressed interest in you.
    //    Re-running only adds what is missing, so the list above can grow.
    for (const seed of SEEDS) {
        if (await LoveProfileModel.findOne({ displayName: `${seed.name} ${SEED_TAG}` }).exec()) {
            console.log(`${seed.name} already seeded — skipped`);
            continue;
        }
        const userId = new Types.ObjectId();
        await users.collection('users').insertOne({
            _id: userId, name: seed.name, email: `${seed.name.toLowerCase()}.devseed@sbc.test`,
            phoneNumber: `+2376000000${10 + SEEDS.indexOf(seed)}`, role: 'user', isVerified: true, blocked: false,
            country: 'CM', region: 'Littoral', sex: seed.sex, city: seed.city, birthDate: new Date(seed.birthDate),
            referralCode: `seed${String(userId).slice(-6)}`, createdAt: new Date(), updatedAt: new Date(),
        } as any);
        await LoveProfileModel.create({
            userId, displayName: `${seed.name} ${SEED_TAG}`, intention: seed.intention,
            description: seed.description, sex: seed.sex, photos: [], status: ProfileStatus.APPROVED,
        });
        if (seed.likesYou) {
            await InterestModel.create({ fromUserId: userId, toUserId: mine.userId, sessionDate: getSessionDateKey(new Date(), cfg) });
            console.log(`seeded ${seed.name} (profile + SBC account) — already interested in you, so your interest back becomes a match`);
        } else {
            console.log(`seeded ${seed.name} (profile + SBC account)`);
        }
    }
    console.log('\nreload /sbclove — « Découvrir » is open.');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message || e); process.exit(1); });
