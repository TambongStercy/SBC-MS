import { Types } from 'mongoose';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import UserModel from '../database/models/user.model';

/**
 * SBC Impact Challenge — qualification counter (cahier des charges §3.2).
 *
 * A candidate unlocks their participation by inviting N people during the
 * qualification window. Rufus's rule (2026-11-23): an invitation counts when the
 * filleul has PAID their pack, and a pack the candidate paid for the filleul from
 * the activation balance counts too. Both create the same CLASSIQUE/CIBLE
 * registration subscription (a Pack Winner creates a CIBLE one), so one rule
 * covers them:
 *
 *   valid = a level-1 referral of the candidate whose FIRST live CLASSIQUE/CIBLE
 *           subscription was created inside [from, to], and whose account is not
 *           deleted, blocked or banned.
 *
 * "First" matters: a member who paid CLASSIQUE before the window and upgrades to
 * CIBLE during it joined SBC before the window, so they do not count. A
 * cancelled subscription (a reversed activation) is ignored.
 *
 * `reachedAt` is the creation time of the N-th valid subscription, in order: the
 * moment the candidate met the condition, which decides the order of arrival for
 * the seats (§3.3). It does not depend on when we noticed.
 */

export const MEMBERSHIP_TYPES = [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE];

export interface InvitationStats {
    referrerId: string;
    /** Valid invitations in the window. */
    valid: number;
    /** Filleuls who signed up in the window and have not paid yet. */
    pending: number;
    /** When the `need`-th valid invitation was paid; null while short. */
    reachedAt: Date | null;
}

const MAX_REFERRERS = 200;

/** Earliest live membership subscription per user, for the given users. */
const firstMembership = async (userIds: Types.ObjectId[]) => {
    if (userIds.length === 0) return new Map<string, Date>();
    const rows: { _id: Types.ObjectId; first: Date }[] = await SubscriptionModel.aggregate([
        {
            $match: {
                user: { $in: userIds },
                // By type only, like referral-stats: CLASSIQUE/CIBLE are always the
                // membership, and older rows carry no `category`.
                subscriptionType: { $in: MEMBERSHIP_TYPES },
                status: { $ne: SubscriptionStatus.CANCELLED },
            },
        },
        { $group: { _id: '$user', first: { $min: '$createdAt' } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.first]));
};

/**
 * Members who can count as an invitation: not blocked, not banned. The User
 * model's soft-delete hook adds `deleted ≠ true` to every find, so deleted
 * accounts are left out here too (asking for them directly would be rewritten).
 */
const usable = async (userIds: Types.ObjectId[]) => {
    if (userIds.length === 0) return new Set<string>();
    const rows = await UserModel.find({
        _id: { $in: userIds },
        blocked: { $ne: true },
        'ban.at': { $exists: false },
    }).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
};

/**
 * Stats for each referrer. With `changedSince`, only referrers who had a
 * level-1 filleul pay a first pack since that instant are computed (the
 * qualification job polls with it); the others are left out of the answer.
 */
export const invitationStats = async (args: {
    referrerIds: string[];
    from: Date;
    to: Date;
    need: number;
    changedSince?: Date;
}): Promise<InvitationStats[]> => {
    const ids = [...new Set(args.referrerIds)]
        .filter((id) => Types.ObjectId.isValid(id))
        .slice(0, MAX_REFERRERS)
        .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return [];

    let referrers = ids;
    if (args.changedSince) {
        // By _id (always indexed; its first 4 bytes are the creation second),
        // not createdAt, which has no index: this runs every few seconds.
        const recent = await SubscriptionModel.find({
            _id: { $gte: Types.ObjectId.createFromTime(Math.floor(args.changedSince.getTime() / 1000)) },
            subscriptionType: { $in: MEMBERSHIP_TYPES },
        }).select('user').lean();
        if (recent.length === 0) return [];
        const changed = await ReferralModel.distinct('referrer', {
            referrer: { $in: ids },
            referredUser: { $in: [...new Set(recent.map((s) => String(s.user)))].map((u) => new Types.ObjectId(u)) },
            referralLevel: 1,
            archived: false,
        });
        referrers = changed as Types.ObjectId[];
        if (referrers.length === 0) return [];
    }

    const out: InvitationStats[] = [];
    for (const referrer of referrers) {
        const refs = await ReferralModel.find({ referrer, referralLevel: 1, archived: false })
            .select('referredUser createdAt').lean();
        const users = refs.map((r) => r.referredUser as Types.ObjectId);
        const [first, ok] = await Promise.all([firstMembership(users), usable(users)]);

        const paidTimes: number[] = [];
        let pending = 0;
        for (const r of refs) {
            const uid = String(r.referredUser);
            if (!ok.has(uid)) continue;
            const paidAt = first.get(uid);
            if (paidAt) {
                const t = paidAt.getTime();
                if (t >= args.from.getTime() && t <= args.to.getTime()) paidTimes.push(t);
            } else {
                const signedUp = (r as any).createdAt as Date | undefined;
                if (signedUp && signedUp >= args.from && signedUp <= args.to) pending++;
            }
        }
        paidTimes.sort((a, b) => a - b);
        out.push({
            referrerId: String(referrer),
            valid: paidTimes.length,
            pending,
            reachedAt: args.need > 0 && paidTimes.length >= args.need ? new Date(paidTimes[args.need - 1]) : null,
        });
    }
    return out;
};

export interface ImpactMember {
    _id: string;
    name: string;
    avatar?: string;
    country?: string;
    city?: string;
    referralCode?: string;
    /** Holds a live CLASSIQUE/CIBLE subscription. */
    isMember: boolean;
    /** Blocked or banned. Deleted accounts are simply absent from the answer. */
    unavailable: boolean;
}

/** Profile subset for candidacies (name, photo, place, SBC id, membership). */
export const impactMembers = async (userIds: string[]): Promise<ImpactMember[]> => {
    const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id)).slice(0, 500)
        .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return [];
    const [users, subs] = await Promise.all([
        UserModel.find({ _id: { $in: ids } })
            .select('name avatar country city referralCode deleted blocked ban').lean(),
        SubscriptionModel.distinct('user', {
            user: { $in: ids },
            subscriptionType: { $in: MEMBERSHIP_TYPES },
            status: SubscriptionStatus.ACTIVE,
            endDate: { $gt: new Date() },
        }),
    ]);
    const members = new Set(subs.map(String));
    return users.map((u: any) => ({
        _id: String(u._id),
        name: u.name,
        avatar: u.avatar,
        country: u.country,
        city: u.city,
        referralCode: u.referralCode,
        isMember: members.has(String(u._id)),
        unavailable: Boolean(u.deleted || u.blocked || u.ban?.at),
    }));
};
