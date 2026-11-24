import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, {
    SubscriptionCategory, SubscriptionStatus, SubscriptionType,
} from '../database/models/subscription.model';
import { impactMembers, invitationStats } from '../services/impact-invitations.service';

/**
 * Asserts the SBC Impact Challenge qualification counter (Rufus 2026-11-23:
 * an invitation counts when the level-1 filleul paid their pack, sponsored
 * activations included, inside the qualification window).
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-impact-invitations.ts
 */

const DB = process.env.IMPACT_INVITATIONS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_impact_invitations_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const FROM = new Date('2026-12-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');
const day = (d: number, h = 12) => new Date(Date.UTC(2026, 11, d, h));

let n = 0;
const user = async (extra: Record<string, unknown> = {}) => {
    const u = await UserModel.create({
        name: `U${n}`, email: `u${n}@impact.test`, phoneNumber: `2376990${String(n++).padStart(5, '0')}`,
        password: 'x', region: 'Centre', country: 'CM', city: 'Douala', ...extra,
    } as any);
    return u._id as Types.ObjectId;
};
/** Raw insert so createdAt can be set in the past. */
const sub = (u: Types.ObjectId, type: SubscriptionType, createdAt: Date, status = SubscriptionStatus.ACTIVE, category = SubscriptionCategory.REGISTRATION) =>
    SubscriptionModel.collection.insertOne({
        // Real ids carry their creation second; the rest made unique.
        _id: new Types.ObjectId(Math.floor(createdAt.getTime() / 1000).toString(16).padStart(8, '0') + new Types.ObjectId().toHexString().slice(8)),
        user: u, subscriptionType: type, status, category, duration: 'lifetime', autoRenew: false,
        startDate: createdAt, endDate: new Date('9999-12-31'), createdAt, updatedAt: createdAt,
    });
const refer = (referrer: Types.ObjectId, referred: Types.ObjectId, level = 1, createdAt = day(2), archived = false) =>
    ReferralModel.collection.insertOne({ referrer, referredUser: referred, referralLevel: level, archived, createdAt, updatedAt: createdAt });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const cand = await user();
    await sub(cand, SubscriptionType.CIBLE, new Date('2026-01-01'));

    // Counted: paid CLASSIQUE on the 3rd, paid CIBLE on the 5th, sponsored (same subscription shape) on the 9th.
    const a = await user(); await refer(cand, a); await sub(a, SubscriptionType.CLASSIQUE, day(3));
    const b = await user(); await refer(cand, b); await sub(b, SubscriptionType.CIBLE, day(5));
    const c = await user(); await refer(cand, c); await sub(c, SubscriptionType.CIBLE, day(9));
    // Not counted: paid before the window, upgraded during it (first pack is what counts).
    const old = await user(); await refer(cand, old, 1, new Date('2026-10-01'));
    await sub(old, SubscriptionType.CLASSIQUE, new Date('2026-10-02')); await sub(old, SubscriptionType.CIBLE, day(4));
    // Not counted: an old pack stored without `category` (older rows), upgraded during the window.
    const legacy = await user(); await refer(cand, legacy, 1, new Date('2025-01-01'));
    await SubscriptionModel.collection.insertOne({ user: legacy, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE, startDate: new Date('2025-01-02'), endDate: new Date('9999-12-31'), createdAt: new Date('2025-01-02'), updatedAt: new Date('2025-01-02') });
    await sub(legacy, SubscriptionType.CIBLE, day(6));
    // Not counted: paid after the window.
    const late = await user(); await refer(cand, late); await sub(late, SubscriptionType.CLASSIQUE, new Date('2027-01-02'));
    // Not counted: level 2.
    const l2 = await user(); await refer(cand, l2, 2); await sub(l2, SubscriptionType.CLASSIQUE, day(6));
    // Not counted: archived referral.
    const arch = await user(); await refer(cand, arch, 1, day(2), true); await sub(arch, SubscriptionType.CLASSIQUE, day(6));
    // Not counted: reversed (cancelled) activation.
    const rev = await user(); await refer(cand, rev); await sub(rev, SubscriptionType.CLASSIQUE, day(6), SubscriptionStatus.CANCELLED);
    // Not counted: a feature add-on only.
    const feat = await user(); await refer(cand, feat); await sub(feat, SubscriptionType.PRO, day(6), SubscriptionStatus.ACTIVE, SubscriptionCategory.FEATURE);
    // Not counted: blocked / deleted / banned filleuls.
    const blk = await user({ blocked: true }); await refer(cand, blk); await sub(blk, SubscriptionType.CLASSIQUE, day(6));
    const del = await user({ deleted: true }); await refer(cand, del); await sub(del, SubscriptionType.CLASSIQUE, day(6));
    const ban = await user({ ban: { at: day(7), reason: 'manual', by: 'test' } }); await refer(cand, ban); await sub(ban, SubscriptionType.CLASSIQUE, day(6));
    // Pending: signed up in the window, not paid (rev and feat also have no live pack, so they are pending too).
    const p1 = await user(); await refer(cand, p1, 1, day(10));
    // Not pending: signed up before the window.
    const p0 = await user(); await refer(cand, p0, 1, new Date('2026-11-01'));
    void p0; void late; void l2; void arch; void old;

    const [s3] = await invitationStats({ referrerIds: [String(cand)], from: FROM, to: TO, need: 3 });
    check('3 valid invitations', s3?.valid === 3, `valid=${s3?.valid}`);
    check('reachedAt = time of the 3rd paid pack', s3?.reachedAt?.getTime() === day(9).getTime(), String(s3?.reachedAt));
    check('pending = unpaid sign-ups inside the window', s3?.pending === 3, `pending=${s3?.pending}`);

    const [s10] = await invitationStats({ referrerIds: [String(cand)], from: FROM, to: TO, need: 10 });
    check('short of 10: reachedAt is null', s10?.reachedAt === null);

    const [s2] = await invitationStats({ referrerIds: [String(cand)], from: FROM, to: TO, need: 2 });
    check('reachedAt follows payment order, not sign-up order', s2?.reachedAt?.getTime() === day(5).getTime());

    // changedSince: no first pack paid since then → the candidate is left out (the
    // "late" filleul paid on 2027-01-02, so ask from 2027-01-03).
    const none = await invitationStats({ referrerIds: [String(cand)], from: FROM, to: TO, need: 3, changedSince: new Date('2027-01-03') });
    check('changedSince with no new payment returns nothing', none.length === 0);
    // A filleul paying now brings the candidate back (asked from just before the payment).
    const d = await user(); await refer(cand, d, 1, day(21)); await sub(d, SubscriptionType.CLASSIQUE, day(21, 15));
    const changed = await invitationStats({ referrerIds: [String(cand)], from: FROM, to: TO, need: 3, changedSince: day(21, 14) });
    check('changedSince picks the candidate whose filleul just paid', changed.length === 1 && changed[0].valid === 4, JSON.stringify(changed));

    // Another referrer is not affected by the candidate's tree.
    const other = await user();
    const [o] = await invitationStats({ referrerIds: [String(other)], from: FROM, to: TO, need: 1 });
    check('other referrer counts nothing', o?.valid === 0 && o.reachedAt === null);

    check('invalid ids are ignored', (await invitationStats({ referrerIds: ['nope'], from: FROM, to: TO, need: 1 })).length === 0);

    // Profile subset.
    const members = await impactMembers([String(cand), String(p1), String(blk)]);
    const byId = new Map(members.map((m) => [m._id, m]));
    check('candidate is a member', byId.get(String(cand))?.isMember === true);
    check('unpaid filleul is not a member', byId.get(String(p1))?.isMember === false);
    check('blocked account is unavailable', byId.get(String(blk))?.unavailable === true);
    check('profile carries city and country', byId.get(String(cand))?.city === 'Douala' && byId.get(String(cand))?.country === 'CM');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
