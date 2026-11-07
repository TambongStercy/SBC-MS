import { Types } from 'mongoose';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';

/** Types the SBC Network app knows (Kersten's note, 2026-11-05). */
const CONTACTS_APP_TYPES = [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE, SubscriptionType.PRO, SubscriptionType.MISE_EN_AVANT];

export interface SubscriptionEntry {
    type: string;
    status: 'active' | 'expired' | 'cancelled';
    startedAt: string | null;
    /** End of the paid period; null for a lifetime pack. */
    expiresAt: string | null;
}

export interface SubscriptionState {
    /** Every active type, as SSO always returned it. */
    subscriptionTypes: string[];
    /** One entry per subscription the Contacts app knows, newest first, with its dates. */
    subscriptions: SubscriptionEntry[];
}

const isLifetime = (d?: Date | null) => !d || d.getUTCFullYear() >= 9000;

export async function getSubscriptionState(userId: string, now: Date = new Date()): Promise<SubscriptionState> {
    const subs = await SubscriptionModel.find({ user: new Types.ObjectId(userId) })
        .select('subscriptionType status startDate endDate')
        .sort({ startDate: -1 })
        .limit(50)
        .lean();

    const isActive = (s: any) => s.status === SubscriptionStatus.ACTIVE && s.endDate > now;
    const subscriptionTypes = Array.from(new Set(subs.filter(isActive).map((s: any) => String(s.subscriptionType))));

    const subscriptions: SubscriptionEntry[] = subs
        .filter((s: any) => CONTACTS_APP_TYPES.includes(s.subscriptionType))
        .map((s: any) => ({
            type: String(s.subscriptionType),
            status: s.status === SubscriptionStatus.CANCELLED ? 'cancelled' : isActive(s) ? 'active' : 'expired',
            startedAt: s.startDate ? new Date(s.startDate).toISOString() : null,
            expiresAt: isLifetime(s.endDate) ? null : new Date(s.endDate).toISOString(),
        }));

    return { subscriptionTypes, subscriptions };
}

/** A paid membership: what "activated" means. Feature subscriptions alone do not count. */
export const isMembershipType = (t: string) => t === SubscriptionType.CLASSIQUE || t === SubscriptionType.CIBLE;
