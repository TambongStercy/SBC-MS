/**
 * Migration Script: Populate denormalized user fields on referrals
 *
 * This script adds referredUserName, referredUserEmail, and referredUserPhone
 * to all existing referral documents for fast search capability.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-referral-denormalization.ts           # Dry run
 *   npx ts-node src/scripts/migrate-referral-denormalization.ts --apply   # Apply changes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI_PROD || 'mongodb://localhost:27017/sbc_user';
const BATCH_SIZE = 1000;
const DRY_RUN = !process.argv.includes('--apply');

interface ReferralDoc {
    _id: mongoose.Types.ObjectId;
    referredUser: mongoose.Types.ObjectId;
    referredUserName?: string;
    referredUserEmail?: string;
    referredUserPhone?: string;
}

interface UserDoc {
    _id: mongoose.Types.ObjectId;
    name?: string;
    email?: string;
    phoneNumber?: string | number;
}

async function migrate() {
    console.log('='.repeat(60));
    console.log('Referral Denormalization Migration');
    console.log('='.repeat(60));
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY MODE'}`);
    console.log(`Database: ${MONGODB_URI}`);
    console.log('');

    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db!;
    const referralsCollection = db.collection('referrals');
    const usersCollection = db.collection('users');

    // Count referrals that need updating (missing any denormalized field)
    const totalToUpdate = await referralsCollection.countDocuments({
        $or: [
            { referredUserName: { $exists: false } },
            { referredUserEmail: { $exists: false } },
            { referredUserPhone: { $exists: false } }
        ]
    });

    const totalReferrals = await referralsCollection.countDocuments({});

    console.log(`Total referrals in database: ${totalReferrals.toLocaleString()}`);
    console.log(`Referrals needing update: ${totalToUpdate.toLocaleString()}`);
    console.log('');

    if (totalToUpdate === 0) {
        console.log('All referrals already have denormalized fields. Nothing to do.');
        await mongoose.disconnect();
        return;
    }

    if (DRY_RUN) {
        console.log('DRY RUN: Would update the following...');

        // Show sample of what would be updated
        const sampleReferrals = await referralsCollection.find({
            $or: [
                { referredUserName: { $exists: false } },
                { referredUserEmail: { $exists: false } },
                { referredUserPhone: { $exists: false } }
            ]
        }).limit(5).toArray();

        for (const ref of sampleReferrals) {
            const user = await usersCollection.findOne({ _id: ref.referredUser });
            if (user) {
                console.log(`  Referral ${ref._id}:`);
                console.log(`    -> referredUserName: "${user.name || ''}"`);
                console.log(`    -> referredUserEmail: "${user.email || ''}"`);
                console.log(`    -> referredUserPhone: "${user.phoneNumber?.toString() || ''}"`);
            }
        }

        console.log('');
        console.log(`Run with --apply to update all ${totalToUpdate.toLocaleString()} referrals.`);
        await mongoose.disconnect();
        return;
    }

    // APPLY MODE
    console.log('Starting migration...');
    let processed = 0;
    let updated = 0;
    let errors = 0;

    // Process in batches using cursor
    const cursor = referralsCollection.find({
        $or: [
            { referredUserName: { $exists: false } },
            { referredUserEmail: { $exists: false } },
            { referredUserPhone: { $exists: false } }
        ]
    }).batchSize(BATCH_SIZE);

    const bulkOps: any[] = [];

    while (await cursor.hasNext()) {
        const referral = await cursor.next() as ReferralDoc;
        if (!referral) continue;

        processed++;

        // Fetch user data
        const user = await usersCollection.findOne({ _id: referral.referredUser }) as UserDoc | null;

        if (!user) {
            errors++;
            continue;
        }

        bulkOps.push({
            updateOne: {
                filter: { _id: referral._id },
                update: {
                    $set: {
                        referredUserName: user.name || '',
                        referredUserEmail: user.email || '',
                        referredUserPhone: user.phoneNumber?.toString() || ''
                    }
                }
            }
        });

        // Execute bulk operation when batch is full
        if (bulkOps.length >= BATCH_SIZE) {
            const result = await referralsCollection.bulkWrite(bulkOps);
            updated += result.modifiedCount;
            bulkOps.length = 0;

            const progress = ((processed / totalToUpdate) * 100).toFixed(1);
            console.log(`Progress: ${processed.toLocaleString()}/${totalToUpdate.toLocaleString()} (${progress}%) - Updated: ${updated.toLocaleString()}`);
        }
    }

    // Execute remaining bulk operations
    if (bulkOps.length > 0) {
        const result = await referralsCollection.bulkWrite(bulkOps);
        updated += result.modifiedCount;
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Migration Complete');
    console.log('='.repeat(60));
    console.log(`Processed: ${processed.toLocaleString()}`);
    console.log(`Updated: ${updated.toLocaleString()}`);
    console.log(`Errors (user not found): ${errors.toLocaleString()}`);

    // Verify indexes exist
    console.log('');
    console.log('Checking indexes...');
    const indexes = await referralsCollection.indexes();
    const indexNames = indexes.map(idx => idx.name);

    const requiredIndexes = [
        'referrer_1_referredUserName_1',
        'referrer_1_referredUserEmail_1',
        'referrer_1_referredUserPhone_1'
    ];

    for (const idx of requiredIndexes) {
        if (indexNames.includes(idx)) {
            console.log(`  [OK] Index ${idx} exists`);
        } else {
            console.log(`  [PENDING] Index ${idx} will be created on next server start`);
        }
    }

    await mongoose.disconnect();
    console.log('');
    console.log('Done!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
