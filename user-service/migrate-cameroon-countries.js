const mongoose = require('mongoose');
const path = require('path');

// Since we can't directly import ES modules in this context, we'll define the mapping here
const countryNameVariations = {
    'cameroon': 'CM',
    'cameroun': 'CM',
    'camerun': 'CM',
    'kamerun': 'CM',
};

function normalizeCountryName(countryInput) {
    if (!countryInput || typeof countryInput !== 'string') {
        return countryInput || '';
    }

    const normalized = countryInput.toLowerCase().trim();

    // Check country name variations  
    if (countryNameVariations[normalized]) {
        return countryNameVariations[normalized];
    }

    // Return original input if no match found
    return countryInput;
}

// Simple user schema for this migration
const userSchema = new mongoose.Schema({
    country: String,
    name: String,
    email: String,
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function migrateCameroonCountries() {
    try {
        console.log('🚀 Starting Cameroon country migration script...');

        // Connect to MongoDB (use environment variable or default)
        const mongoUri = "mongodb://stercytambong:w23N0S5Qb6kMUwTi@217.65.144.32:27017/sbc_users?retryWrites=true&w=majority";
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');

        // Find all users with Cameroon variations (case insensitive)
        const cameroonVariations = [
            /^cameroon$/i,
            /^cameroun$/i,
            /^camerun$/i,
            /^kamerun$/i
        ];

        const query = {
            country: { $in: cameroonVariations }
        };

        console.log('🔍 Searching for users with Cameroon country variations...');
        const usersToUpdate = await User.find(query).exec();

        console.log(`📊 Found ${usersToUpdate.length} users with Cameroon country variations`);

        if (usersToUpdate.length === 0) {
            console.log('✅ No users found to update. Migration completed.');
            return;
        }

        // Log the variations found
        const foundVariations = new Set();
        usersToUpdate.forEach(user => {
            if (user.country) {
                foundVariations.add(user.country);
            }
        });
        console.log('📋 Found country variations:', Array.from(foundVariations));

        // Update users in batches
        const batchSize = 100;
        let updatedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < usersToUpdate.length; i += batchSize) {
            const batch = usersToUpdate.slice(i, i + batchSize);

            console.log(`⚙️  Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(usersToUpdate.length / batchSize)}`);

            const updatePromises = batch.map(async (user) => {
                try {
                    const originalCountry = user.country;
                    const normalizedCountry = normalizeCountryName(user.country);

                    if (originalCountry !== normalizedCountry) {
                        await User.updateOne(
                            { _id: user._id },
                            { $set: { country: normalizedCountry } }
                        );

                        console.log(`✏️  Updated user ${user._id}: ${originalCountry} -> ${normalizedCountry}`);
                        return { success: true, userId: user._id, from: originalCountry, to: normalizedCountry };
                    } else {
                        console.log(`⏭️  User ${user._id} country already normalized: ${originalCountry}`);
                        return { success: true, userId: user._id, from: originalCountry, to: normalizedCountry, skipped: true };
                    }
                } catch (error) {
                    console.error(`❌ Error updating user ${user._id}:`, error);
                    return { success: false, userId: user._id, error: error.message };
                }
            });

            const results = await Promise.all(updatePromises);

            // Count results
            results.forEach(result => {
                if (result.success) {
                    if (!result.skipped) {
                        updatedCount++;
                    }
                } else {
                    errorCount++;
                }
            });
        }

        console.log('🎉 Migration completed successfully!');
        console.log(`📈 Total users processed: ${usersToUpdate.length}`);
        console.log(`✅ Users updated: ${updatedCount}`);
        console.log(`❌ Errors encountered: ${errorCount}`);

        // Verify the migration
        console.log('🔍 Verifying migration...');
        const remainingCameroonUsers = await User.find(query).exec();

        if (remainingCameroonUsers.length === 0) {
            console.log('✅ Migration verification successful! No more Cameroon variations found.');
        } else {
            console.warn(`⚠️ Migration incomplete: ${remainingCameroonUsers.length} users still have Cameroon variations`);
            remainingCameroonUsers.forEach(user => {
                console.warn(`User ${user._id} still has country: ${user.country}`);
            });
        }

        // Show final statistics
        const totalCMUsers = await User.countDocuments({ country: 'CM' });
        console.log(`🇨🇲 Total users with country 'CM': ${totalCMUsers}`);

    } catch (error) {
        console.error('💥 Migration failed with error:', error);
        throw error;
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the migration
migrateCameroonCountries()
    .then(() => {
        console.log('🎊 Migration script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Migration script failed:', error);
        process.exit(1);
    }); 