const mongoose = require('mongoose');
require('dotenv').config();

const USER_DB_URI = process.env.USER_DB_URI || 'mongodb://localhost:27017/sbc_user_dev';
const TARGET_USER_ID = '65d4ddea8ce5ffe48a44a8dd';

const subscriptionSchema = new mongoose.Schema({}, { strict: false, collection: 'subscriptions' });

async function checkUserSubscription() {
    let userConnection;

    try {
        userConnection = await mongoose.createConnection(USER_DB_URI, {
            serverSelectionTimeoutMS: 5000
        }).asPromise();

        const Subscription = userConnection.model('Subscription', subscriptionSchema);

        const subscription = await Subscription.findOne({
            user: TARGET_USER_ID,
            status: 'active',
            category: 'registration',
            subscriptionType: { $in: ['CLASSIQUE', 'CIBLE'] }
        }).lean();

        console.log('User ID:', TARGET_USER_ID);
        console.log('Is Subscribed:', !!subscription);
        if (subscription) {
            console.log('Subscription Type:', subscription.subscriptionType);
            console.log('Status:', subscription.status);
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (userConnection) await userConnection.close();
    }
}

checkUserSubscription().then(() => process.exit(0));
