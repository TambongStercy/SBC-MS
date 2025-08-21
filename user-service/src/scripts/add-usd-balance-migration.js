const mongoose = require('mongoose');
const config = require('../config');

// Connect to MongoDB
async function connectDB() {
    try {
        await mongoose.connect(config.default.mongoUri);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// Migration script to add usdBalance field to all users
async function addUsdBalanceToUsers() {
    try {
        console.log('Starting USD balance migration...');
        
        // Update all users to have usdBalance: 0 if they don't have it
        const result = await mongoose.connection.db.collection('users').updateMany(
            { usdBalance: { $exists: false } },
            { $set: { usdBalance: 0 } }
        );
        
        console.log(`Migration completed. Updated ${result.modifiedCount} users with usdBalance field.`);
        
        // Verify the migration
        const totalUsers = await mongoose.connection.db.collection('users').countDocuments();
        const usersWithUsdBalance = await mongoose.connection.db.collection('users').countDocuments({
            usdBalance: { $exists: true }
        });
        
        console.log(`Total users: ${totalUsers}`);
        console.log(`Users with usdBalance: ${usersWithUsdBalance}`);
        
        if (totalUsers === usersWithUsdBalance) {
            console.log('✅ Migration successful! All users now have usdBalance field.');
        } else {
            console.log('⚠️  Migration incomplete. Some users may not have usdBalance field.');
        }
        
    } catch (error) {
        console.error('Error during migration:', error);
    }
}

// Run migration
async function runMigration() {
    await connectDB();
    await addUsdBalanceToUsers();
    await mongoose.connection.close();
    console.log('Migration completed and database connection closed.');
}

// Execute if run directly
if (require.main === module) {
    runMigration().catch(console.error);
}

module.exports = { addUsdBalanceToUsers };