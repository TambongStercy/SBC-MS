const mongoose = require('mongoose');

async function updateTargets() {
    try {
        await mongoose.connect(process.env.MONGODB_URI_DEV || 'mongodb://localhost:27017/sbc_notification_dev');
        console.log('Connected to MongoDB');

        const result = await mongoose.connection.db.collection('relancetargets').updateMany(
            { status: 'active' },
            { $set: { nextMessageDue: new Date() } }
        );

        console.log(`Updated ${result.modifiedCount} targets to send immediately`);
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

updateTargets();
