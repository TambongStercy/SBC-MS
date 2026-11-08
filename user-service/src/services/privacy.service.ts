import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import ReferralModel from '../database/models/referral.model';
import { PRIVACY_POLICY_VERSION } from '../config/privacy';
import logger from '../utils/logger';

const log = logger.getLogger('PrivacyService');
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/**
 * Members' data-protection rights (APDP Benin, deliberation 2026-523 of
 * 27 Aug 2026; Code du numérique arts 437-443): consent, access/portability
 * (download), erasure (delete own account). Rectification is the profile
 * pages; objection is the contact-sharing switch and notification settings.
 */

/** Records the consents a member gives in the consent window. */
export async function recordConsents(userId: string, input: { privacy?: unknown; dataTransfer?: unknown }, ip?: string) {
    if (input?.privacy !== true || input?.dataTransfer !== true) {
        throw httpError(400, 'Les deux accords sont nécessaires pour continuer.');
    }
    const at = { acceptedAt: new Date(), version: PRIVACY_POLICY_VERSION, ...(ip ? { ip } : {}) };
    await UserModel.updateOne({ _id: userId }, { $set: { 'consents.privacy': at, 'consents.dataTransfer': at } });
    log.info(`Consents ${PRIVACY_POLICY_VERSION} recorded for user ${userId}`);
    const user = await UserModel.findById(userId).select('consents').lean() as any;
    return { consents: user?.consents ?? null };
}

/** Never in an export: credentials, codes and tokens. */
const SECRET_FIELDS = ['password', 'otps', 'contactsOtps', 'token', 'passwordResetToken', 'passwordResetTokenExpiration', '__v'];

/** Everything SBC holds about the member, in a portable format (JSON). */
export async function exportUserData(userId: string) {
    const user = await UserModel.findById(userId).lean() as any;
    if (!user) throw httpError(404, 'Utilisateur introuvable.');
    for (const f of SECRET_FIELDS) delete user[f];
    for (const k of Object.keys(user)) if (/secret|otp|token/i.test(k)) delete user[k];

    const subscriptions = await SubscriptionModel.find({ user: new Types.ObjectId(userId) })
        .select('subscriptionType status startDate endDate category duration createdAt').lean();
    const [direct, indirect] = await Promise.all([
        ReferralModel.countDocuments({ referrer: new Types.ObjectId(userId), referralLevel: 1, archived: { $ne: true } }),
        ReferralModel.countDocuments({ referrer: new Types.ObjectId(userId), referralLevel: { $in: [2, 3] }, archived: { $ne: true } }),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        controller: 'ETS SNIPER BUSINESS CENTER — Responsable du traitement : Mme Adèle AGONGNON',
        authorisation: 'APDP Bénin, Délibération n° 2026-523/AT/APDP/DST/SC du 27 août 2026',
        profile: user,
        subscriptions: subscriptions.map((s: any) => ({
            type: s.subscriptionType, status: s.status, startDate: s.startDate,
            endDate: new Date(s.endDate).getUTCFullYear() >= 9000 ? null : s.endDate,
        })),
        referrals: { direct, indirect },
        note: 'Votre historique de paiements et de retraits est dans la page Portefeuille de l\'application.',
    };
}

/**
 * The member deletes their own account (right to erasure). Same soft delete
 * as the admin one: the account and its data stop being used and shown
 * (search, contacts file, login), and the referral tree stays consistent.
 */
export async function deleteOwnAccount(userId: string, password: string) {
    const user = await UserModel.findById(userId).select('+password').lean() as any;
    if (!user) throw httpError(404, 'Utilisateur introuvable.');
    if (!password || !user.password || !(await bcrypt.compare(String(password), user.password))) {
        throw httpError(400, 'Mot de passe incorrect.');
    }
    await UserModel.updateOne({ _id: userId }, {
        $set: { deleted: true, deletedAt: new Date(), deletionReason: 'member_request', shareContactInfo: false },
        $unset: { token: '' },
    });
    log.info(`User ${userId} deleted their own account (member request)`);
    return { deleted: true };
}
