/**
 * Backfill Bounce Suppression List
 *
 * Reads all RelanceTarget documents with bounced=true in messagesDelivered,
 * resolves the referral user's email address from the user DB,
 * and inserts them into the RelanceBounceSuppression collection.
 *
 * Run ONCE before re-enabling relance sends to clean the list.
 * Usage: NODE_ENV=production node scripts/backfill-bounce-suppression.js
 *        NODE_ENV=development node scripts/backfill-bounce-suppression.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';

const NOTIFICATION_DB_URI = NODE_ENV === 'production'
    ? process.env.NOTIFICATION_MONGODB_URI_PROD || 'mongodb://localhost:27017/sbc_notification_prod'
    : process.env.NOTIFICATION_MONGODB_URI_DEV || 'mongodb://localhost:27017/sbc_notification_dev';

const USER_DB_URI = NODE_ENV === 'production'
    ? process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_prod'
    : process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';

// Hard bounce reason patterns — soft bounces (mailbox full, server down) are NOT suppressed
const HARD_BOUNCE_PATTERNS = [
    /user unknown/i,
    /does not exist/i,
    /no such user/i,
    /invalid address/i,
    /address rejected/i,
    /mailbox not found/i,
    /bad destination/i,
    /invalid recipient/i,
    /550/,
    /551/,
    /553/,
    /554/,
];

function isHardBounce(reason) {
    if (!reason) return true; // default to hard if no reason provided
    return HARD_BOUNCE_PATTERNS.some(pattern => pattern.test(reason));
}

async function main() {
    console.log(`[Backfill] Starting bounce suppression backfill (env: ${NODE_ENV})`);
    console.log(`[Backfill] Notification DB: ${NOTIFICATION_DB_URI}`);
    console.log(`[Backfill] User DB: ${USER_DB_URI}`);

    // Connect to both databases
    const notifConn = await mongoose.createConnection(NOTIFICATION_DB_URI).asPromise();
    const userConn = await mongoose.createConnection(USER_DB_URI).asPromise();

    console.log('[Backfill] Connected to both databases');

    // Minimal schemas — just enough to query what we need
    const RelanceTargetSchema = new mongoose.Schema({
        referralUserId: mongoose.Schema.Types.ObjectId,
        messagesDelivered: [{
            bounced: Boolean,
            bounceReason: String,
            bouncedAt: Date,
        }]
    }, { strict: false });

    const UserSchema = new mongoose.Schema({
        _id: mongoose.Schema.Types.ObjectId,
        email: String,
    }, { strict: false });

    const RelanceBounceSuppressionSchema = new mongoose.Schema({
        email: { type: String, unique: true, lowercase: true, trim: true },
        reason: String,
        bouncedAt: Date,
        source: String,
    }, { timestamps: true });

    const RelanceTarget = notifConn.model('RelanceTarget', RelanceTargetSchema);
    const User = userConn.model('User', UserSchema);
    const RelanceBounceSuppression = notifConn.model('RelanceBounceSuppression', RelanceBounceSuppressionSchema);

    // Find all targets with at least one bounced message
    console.log('[Backfill] Querying bounced targets...');
    const bouncedTargets = await RelanceTarget.find({
        'messagesDelivered.bounced': true
    }).select('referralUserId messagesDelivered').lean();

    console.log(`[Backfill] Found ${bouncedTargets.length} targets with bounces`);

    // Collect unique referral user IDs
    const referralUserIds = [...new Set(bouncedTargets.map(t => t.referralUserId.toString()))];
    console.log(`[Backfill] Unique referral users: ${referralUserIds.length}`);

    // Batch-fetch emails from user DB
    const users = await User.find({
        _id: { $in: referralUserIds }
    }).select('_id email').lean();

    const emailMap = new Map(users.map(u => [u._id.toString(), u.email]));
    console.log(`[Backfill] Resolved ${emailMap.size} email addresses`);

    let suppressed = 0;
    let skipped = 0;
    let softBounce = 0;
    let noEmail = 0;

    for (const target of bouncedTargets) {
        const email = emailMap.get(target.referralUserId.toString());
        if (!email) {
            noEmail++;
            continue;
        }

        // Find the first hard bounce entry
        const hardBounce = target.messagesDelivered.find(
            m => m.bounced && isHardBounce(m.bounceReason)
        );

        if (!hardBounce) {
            softBounce++;
            continue; // Only soft bounces — don't suppress
        }

        try {
            await RelanceBounceSuppression.updateOne(
                { email: email.toLowerCase() },
                {
                    $setOnInsert: {
                        email: email.toLowerCase(),
                        reason: hardBounce.bounceReason || 'Hard bounce (backfill)',
                        bouncedAt: hardBounce.bouncedAt || new Date(),
                        source: 'backfill',
                    }
                },
                { upsert: true }
            );
            suppressed++;
        } catch (err) {
            if (err.code === 11000) {
                skipped++; // Already in suppression list
            } else {
                console.error(`[Backfill] Error upserting ${email}:`, err.message);
            }
        }
    }

    console.log('\n[Backfill] ===== RESULTS =====');
    console.log(`  Added to suppression list: ${suppressed}`);
    console.log(`  Already suppressed (skipped): ${skipped}`);
    console.log(`  Soft bounces (not suppressed): ${softBounce}`);
    console.log(`  No email found: ${noEmail}`);
    console.log(`  Total targets processed: ${bouncedTargets.length}`);

    await notifConn.close();
    await userConn.close();
    console.log('[Backfill] Done.');
}

main().catch(err => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
});
