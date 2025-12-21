const mongoose = require('mongoose');
require('dotenv').config();

const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const TARGET_USER_ID = '65d4ddea8ce5ffe48a44a8dd';

const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });

async function debugSubscriptionQuery() {
    let userConnection;

    try {
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();

        const Subscription = userConnection.model('Subscription', subscriptionSchema);

        console.log('🔍 Checking subscriptions for user:', TARGET_USER_ID, '\n');

        // Check ALL subscriptions for this user
        const allSubscriptions = await Subscription.find({
            user: TARGET_USER_ID
        }).lean();

        console.log(`Total subscriptions for this user: ${allSubscriptions.length}\n`);

        if (allSubscriptions.length > 0) {
            allSubscriptions.forEach((sub, index) => {
                console.log(`Subscription #${index + 1}:`);
                console.log(`  Type: ${sub.subscriptionType}`);
                console.log(`  Category: ${sub.category}`);
                console.log(`  Status: ${sub.status}`);
                console.log(`  Start: ${sub.startDate}`);
                console.log(`  End: ${sub.endDate}`);
                console.log('');
            });
        } else {
            console.log('❌ NO SUBSCRIPTIONS FOUND FOR THIS USER');
            console.log('This user is NOT subscribed and should not be analyzed.\n');
        }

        // Check total subscriptions in collection
        const totalSubs = await Subscription.countDocuments();
        console.log(`Total subscription documents in collection: ${totalSubs}`);

        // Check unique users with CLASSIQUE/CIBLE
        const classiqueCibleUsers = await Subscription.find({
            category: 'registration',
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        }).distinct('user');
        console.log(`Unique users with CLASSIQUE/CIBLE subscriptions: ${classiqueCibleUsers.length}`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (userConnection) await userConnection.close();
    }
}

debugSubscriptionQuery().then(() => process.exit(0));
