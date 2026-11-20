import mongoose from 'mongoose';
import config from '../config';
import UserModel from '../database/models/user.model';
import { memberAuthService } from '../services/member-auth.service';

/**
 * Lost phone (Security plan Phase 3): after support has checked the member's
 * identity (ID + selfie), removes their authenticator app so they can set up a
 * new one. Withdrawals are locked 72 h and the member is told by e-mail.
 *
 *   npx ts-node src/scripts/reset-member-authenticator.ts <email|phone|userId> --reason "ticket SUP-000123"          (dry run)
 *   npx ts-node src/scripts/reset-member-authenticator.ts <email|phone|userId> --reason "ticket SUP-000123" --apply
 */
const main = async () => {
    const who = process.argv[2];
    const reasonIdx = process.argv.indexOf('--reason');
    const reason = reasonIdx > 0 ? process.argv[reasonIdx + 1] : '';
    const apply = process.argv.includes('--apply');
    if (!who || !reason) {
        console.error('Usage: reset-member-authenticator.ts <email|phone|userId> --reason "<ticket / why>" [--apply]');
        process.exit(2);
    }
    await mongoose.connect(config.mongodb.uri);
    const user = await UserModel.findOne(mongoose.isValidObjectId(who)
        ? { _id: who }
        : { $or: [{ email: who.toLowerCase() }, { phoneNumber: who.replace(/\D/g, '') }] });
    if (!user) {
        console.error(`No account for ${who}.`);
        process.exit(1);
    }
    const status = await memberAuthService.status(user._id);
    console.log(`${user.name} <${user.email}> ${user._id}: authenticator ${status.enabled ? `on since ${status.enrolledAt}` : 'not set up'}.`);
    if (!status.enabled) {
        await mongoose.disconnect();
        return;
    }
    if (!apply) {
        console.log('Dry run: add --apply to remove it and lock withdrawals 72 h.');
    } else {
        const r = await memberAuthService.resetBySupport(user._id, reason);
        console.log(`Removed. Withdrawals locked until ${r.withdrawalsLockedUntil}. The member was e-mailed.`);
    }
    await mongoose.disconnect();
};

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
