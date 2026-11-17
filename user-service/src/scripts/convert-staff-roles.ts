/**
 * Moves the two pre-module staff roles to `staff` with per-module rights,
 * keeping exactly what they could open (config/admin-modules.ts):
 *   withdrawal_admin → { withdrawals: 'write' }
 *   moderator        → { adsProofs: 'write' }
 *
 * Dry run by default; --apply writes. Safe to re-run (only those two roles
 * are touched). effectivePermissions() still understands both old roles, so
 * nothing breaks between the deploy and this run.
 *
 *   npx ts-node src/scripts/convert-staff-roles.ts            # dry run
 *   npx ts-node src/scripts/convert-staff-roles.ts --apply
 */
import mongoose from 'mongoose';
import config from '../config';
import UserModel, { UserRole } from '../database/models/user.model';
import { effectivePermissions } from '../config/admin-modules';

const apply = process.argv.includes('--apply');

async function main() {
    await mongoose.connect(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 });
    const legacy = await UserModel.find({ role: { $in: [UserRole.WITHDRAWAL_ADMIN, UserRole.MODERATOR] } })
        .select('email role').lean();
    console.log(`${legacy.length} account(s) on an old staff role${apply ? '' : ' (dry run)'}`);
    for (const u of legacy) {
        const permissions = effectivePermissions(u.role);
        console.log(`  ${u.email}: ${u.role} → staff ${JSON.stringify(permissions)}`);
        if (apply) {
            await UserModel.updateOne(
                { _id: u._id, role: u.role },
                { $set: { role: UserRole.STAFF, adminPermissions: permissions } },
            );
        }
    }
    if (!apply && legacy.length) console.log('Re-run with --apply to convert them.');
    await mongoose.disconnect();
}

main().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
