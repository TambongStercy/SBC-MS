const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from the root .env file
// Adjust the path if your .env file is located elsewhere relative to the script
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// --- Database Connection ---
// Uses the same environment variable as the main application (adjust if needed)
const MONGODB_URI = 'mongodb://127.0.0.1:27017/SBC';

if (!MONGODB_URI) {
    console.error('Error: MONGODB_URI not found in environment variables.');
    process.exit(1);
}

// --- Mongoose Schemas (Minimal for this script) ---
// Note: Using the exact collection names 'users' and 'subscribes' from the old DB
const UserSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
}, { collection: 'users', strict: false }); // strict: false to allow other fields

const SubscribeSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Reference the model name defined below
        required: true
    },
    plan: { type: String },
    date: { type: Date }
}, { collection: 'subscribes', strict: false });

const User = mongoose.model('User', UserSchema);
const Subscribe = mongoose.model('Subscribe', SubscribeSchema);

// --- Main Script Logic ---
async function findOrphanSubscriptions() {
    let connection;
    try {
        console.log('Connecting to MongoDB...');
        connection = await mongoose.connect(MONGODB_URI);
        console.log('MongoDB connected successfully.');

        console.log('Fetching all user IDs...');
        // Fetch only the _id field, lean() for performance, convert ObjectId to string
        const usersResult = await User.find({}, '_id').lean();
        const userIds = new Set(usersResult.map(u => u._id.toString()));
        console.log(`Found ${userIds.size} unique user IDs.`);

        if (userIds.size === 0) {
            console.warn('No users found in the users collection. Cannot check for orphans.');
            return;
        }

        console.log('Checking subscriptions for orphans...');
        const cursor = Subscribe.find().lean().cursor(); // Use a cursor for memory efficiency

        let checkedCount = 0;
        let orphanCount = 0;
        const orphanSubscriptions = [];

        await cursor.eachAsync(async (sub) => {
            checkedCount++;
            if (checkedCount % 1000 === 0) {
                console.log(`Checked ${checkedCount} subscriptions...`);
            }

            // Check if the subscription's user exists in the set
            if (!sub.user || !userIds.has(sub.user.toString())) {
                orphanCount++;
                const orphanInfo = {
                    subscriptionId: sub._id.toString(),
                    orphanUserId: sub.user ? sub.user.toString() : 'MISSING_USER_FIELD',
                    plan: sub.plan,
                    date: sub.date
                };
                orphanSubscriptions.push(orphanInfo);
                // Log immediately or collect and log at the end
                // console.log(`Found orphan subscription: ID=${orphanInfo.subscriptionId}, UserID=${orphanInfo.orphanUserId}`);
            }
        });

        console.log('\n--- Check Complete ---');
        console.log(`Total subscriptions checked: ${checkedCount}`);
        console.log(`Total orphan subscriptions found: ${orphanCount}`);

        if (orphanCount > 0) {
            console.log('\nOrphan Subscription Details:');
            // Log the collected orphans
            orphanSubscriptions.forEach(orphan => {
                console.log(`  Subscription ID: ${orphan.subscriptionId}, Orphan User ID: ${orphan.orphanUserId}, Plan: ${orphan.plan}, Date: ${orphan.date}`);
            });
            // Optionally write to a file
            // const fs = require('fs');
            // fs.writeFileSync('orphan_subscriptions.json', JSON.stringify(orphanSubscriptions, null, 2));
            // console.log('Orphan details saved to orphan_subscriptions.json');
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (connection) {
            console.log('Disconnecting from MongoDB...');
            await mongoose.disconnect();
            console.log('Disconnected.');
        }
    }
}

// Run the script
findOrphanSubscriptions(); 