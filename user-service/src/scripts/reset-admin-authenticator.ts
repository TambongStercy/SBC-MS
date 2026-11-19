import mongoose from 'mongoose';
import config from '../config';
import UserModel, { ADMIN_CAPABLE_ROLES, UserRole } from '../database/models/user.model';
import { resetAuthenticator, securityStatus } from '../services/admin-auth.service';

/**
 * Last resort when an admin has lost their phone AND their backup codes and no
 * other super admin can reset them from the Équipe page. Removes the account's
 * authenticator and backup codes and ends its sessions; the next sign-in sends a
 * code to the account's email, then asks to set up a new authenticator.
 *
 *   npx ts-node src/scripts/reset-admin-authenticator.ts --email someone@example.com           (dry run)
 *   npx ts-node src/scripts/reset-admin-authenticator.ts --email someone@example.com --apply
 *   (on the server, from dist: node dist/scripts/reset-admin-authenticator.js …)
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };

const main = async () => {
    const email = (arg('--email') || '').trim().toLowerCase();
    const apply = process.argv.includes('--apply');
    if (!email) throw new Error('--email is required');
    await mongoose.connect(config.mongodb.uri);
    const user = await UserModel.findOne({ email }).select('email role').lean();
    if (!user || !ADMIN_CAPABLE_ROLES.includes(user.role as UserRole)) throw new Error(`${email}: no admin account with this email`);
    const id = String(user._id);
    console.log(`${email} (${user.role}): ${JSON.stringify((await securityStatus([id]))[id])}`);
    if (!apply) { console.log('Dry run. Add --apply to reset this authenticator.'); return; }
    const r = await resetAuthenticator(id, 'server script');
    console.log(`Reset done; ${r.sessionsEnded} session(s) ended. Next sign-in: emailed code, then a new authenticator.`);
};

main().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
