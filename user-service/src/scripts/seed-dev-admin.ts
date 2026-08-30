/**
 * Creates (or resets) a local admin account for the admin console.
 *
 * Dev only — it refuses to run against NODE_ENV=production, because it writes a
 * known password. Re-running resets that password, so it doubles as "I locked
 * myself out of the local admin".
 *
 * Run: npx ts-node src/scripts/seed-dev-admin.ts [email] [password]
 */
import mongoose from 'mongoose';
import connectDB from '../database/connection';
import UserModel, { UserRole } from '../database/models/user.model';

const EMAIL = process.argv[2] || 'dev-admin@sbc.test';
const PASSWORD = process.argv[3] || 'SbcLove!Admin2026';

async function main() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to seed a known-password admin in production.');
    }
    await connectDB();

    const existing = await UserModel.findOne({ email: EMAIL }).exec();
    if (existing) {
        // Assigning triggers the model's pre-save hook, which hashes it.
        existing.password = PASSWORD;
        existing.role = UserRole.ADMIN;
        existing.blocked = false;
        existing.deleted = false;
        await existing.save();
        console.log('existing account reset to admin');
    } else {
        await UserModel.create({
            name: 'Dev Admin',
            email: EMAIL,
            password: PASSWORD,
            phoneNumber: '+237600000001',
            role: UserRole.ADMIN,
            isVerified: true,
            region: 'Littoral',
            country: 'CM',
            city: 'Douala',
            sex: 'male',
        });
        console.log('admin account created');
    }

    console.log(`\n  email    : ${EMAIL}\n  password : ${PASSWORD}\n  console  : http://localhost:3030/login\n`);
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
