import mongoose from 'mongoose';
import RelanceTargetModel, { ExitReason, TargetStatus } from '../database/models/relance-target.model';
import CampaignModel from '../database/models/relance-campaign.model';
import { pushFilleulPaid } from './relance-alerts.service';
import logger from '../utils/logger';

const log = logger.getLogger('RelancePaidExit');

/**
 * Takes a filleul who has just paid out of every relance journey at once, and
 * tells each parrain once.
 *
 * A new filleul can be in two journeys of the same parrain (relance des
 * nouveaux and a running campaign). Payment used to close only one of them;
 * the other stayed open until the sender noticed the payment days later and
 * pushed « X vient de payer » a second time, with no commission behind it
 * (Le Futuriste, 2026-11-17).
 */
export async function exitPaidReferral(referralUserId: string | mongoose.Types.ObjectId): Promise<number> {
    const targets = await RelanceTargetModel.find({
        referralUserId,
        status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] },
    });
    if (!targets.length) return 0;

    const announced = new Set<string>();
    const alreadyAnnounced = await RelanceTargetModel.distinct('referrerUserId', { referralUserId, exitReason: ExitReason.PAID });
    alreadyAnnounced.forEach(id => announced.add(String(id)));

    const now = new Date();
    for (const target of targets) {
        target.status = TargetStatus.COMPLETED;
        target.exitReason = ExitReason.PAID;
        target.exitedLoopAt = now;
        await target.save();
        if (target.campaignId) {
            await CampaignModel.findByIdAndUpdate(target.campaignId, { $inc: { targetsConverted: 1 } });
        }
        const referrer = String(target.referrerUserId);
        if (!announced.has(referrer)) {
            announced.add(referrer);
            pushFilleulPaid(referrer, String(referralUserId));
        }
    }
    log.info(`Filleul ${referralUserId} paid: left ${targets.length} relance journey(s)`);
    return targets.length;
}
