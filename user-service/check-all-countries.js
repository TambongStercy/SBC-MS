const mongoose = require('mongoose');

// All supported countries and their variations from phone.utils.ts
const countryDialingCodes = {
    CM: '237', BJ: '229', CG: '242', GH: '233',
    CI: '225', SN: '221', TG: '228', BF: '226',
    GN: '224', ML: '223', NE: '227', GA: '241',
    CD: '243', KE: '254', NG: '234',
};

const countryNameVariations = {
    // Cameroon variations
    'cameroon': 'CM', 'cameroun': 'CM', 'camerun': 'CM', 'kamerun': 'CM',

    // Benin variations
    'benin': 'BJ', 'bénin': 'BJ', 'béninoise': 'BJ', 'beninoise': 'BJ',

    // Côte d'Ivoire variations
    'cote divoire': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
    'cote-d\'ivoire': 'CI', 'cote-divoire': 'CI', 'cotedivoire': 'CI', 'ivorian': 'CI',

    // Congo variations (Democratic Republic)
    'democratic republic of congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo kinshasa': 'CD',
    'zaire': 'CD', 'congo-kinshasa': 'CD', 'rdc': 'CD', 'republique democratique du congo': 'CD',

    // Congo variations (Republic)
    'republic of congo': 'CG', 'congo brazzaville': 'CG', 'congo': 'CG', 'congo-brazzaville': 'CG',
    'republique du congo': 'CG', 'congo republic': 'CG',

    // Senegal variations
    'senegal': 'SN', 'sénégal': 'SN', 'senegalese': 'SN', 'sénégalais': 'SN',

    // Burkina Faso variations
    'burkina faso': 'BF', 'burkina': 'BF', 'burkina-faso': 'BF', 'burkinabe': 'BF',
    'burkinafaso': 'BF', 'burkina_faso': 'BF',

    // Ghana variations
    'ghana': 'GH', 'ghanaian': 'GH', 'gold coast': 'GH',

    // Nigeria variations
    'nigeria': 'NG', 'nigéria': 'NG', 'nigerian': 'NG', 'nigérian': 'NG',
    'federal republic of nigeria': 'NG',

    // Kenya variations
    'kenya': 'KE', 'kenyan': 'KE', 'republic of kenya': 'KE',

    // Guinea variations
    'guinea': 'GN', 'guinée': 'GN', 'guinea conakry': 'GN', 'guinée-conakry': 'GN',
    'republic of guinea': 'GN', 'republique de guinee': 'GN',

    // Mali variations
    'mali': 'ML', 'malian': 'ML', 'republic of mali': 'ML', 'republique du mali': 'ML',

    // Niger variations
    'niger': 'NE', 'nigerien': 'NE', 'republic of niger': 'NE', 'republique du niger': 'NE',

    // Gabon variations
    'gabon': 'GA', 'gabonese': 'GA', 'gabonais': 'GA', 'republic of gabon': 'GA',
    'republique gabonaise': 'GA',

    // Togo variations
    'togo': 'TG', 'togolese': 'TG', 'togolais': 'TG', 'republic of togo': 'TG',
    'republique togolaise': 'TG',
};

function normalizeCountryName(countryInput) {
    if (!countryInput || typeof countryInput !== 'string') {
        return countryInput || '';
    }

    const normalized = countryInput.toLowerCase().trim();

    // Check if it's already a valid ISO code (uppercase)
    if (countryDialingCodes[countryInput.toUpperCase()]) {
        return countryInput.toUpperCase();
    }

    // Check country name variations  
    if (countryNameVariations[normalized]) {
        return countryNameVariations[normalized];
    }

    // Return original input if no match found
    return countryInput;
}

// Simple user schema for this check
const userSchema = new mongoose.Schema({
    country: String,
    name: String,
    email: String,
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function analyzeCountryData() {
    try {
        console.log('🌍 Starting comprehensive country data analysis...');

        // Connect to MongoDB
        const mongoUri = "mongodb://stercytambong:w23N0S5Qb6kMUwTi@217.65.144.32:27017/sbc_users?retryWrites=true&w=majority";
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');

        // Get all unique country values from the database
        console.log('📊 Analyzing current country data...');
        const countryAggregation = await User.aggregate([
            {
                $group: {
                    _id: '$country',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        console.log(`\n📈 Found ${countryAggregation.length} unique country values in database:\n`);

        let totalUsers = 0;
        let normalizable = [];
        let alreadyNormalized = [];
        let unknownCountries = [];

        countryAggregation.forEach(item => {
            const country = item._id;
            const count = item.count;
            totalUsers += count;

            if (!country) {
                console.log(`❓ NULL/Empty country: ${count} users`);
                unknownCountries.push({ original: null, count, reason: 'NULL/Empty' });
                return;
            }

            const normalized = normalizeCountryName(country);
            const isAlreadyISO = countryDialingCodes[country];

            if (country === normalized && isAlreadyISO) {
                // Already properly normalized
                console.log(`✅ ${country}: ${count} users (already normalized)`);
                alreadyNormalized.push({ country, count });
            } else if (country !== normalized && countryNameVariations[country.toLowerCase()]) {
                // Can be normalized
                console.log(`🔄 ${country} -> ${normalized}: ${count} users (can normalize)`);
                normalizable.push({ original: country, normalized, count });
            } else if (countryDialingCodes[country.toUpperCase()]) {
                // ISO code but wrong case
                console.log(`🔤 ${country} -> ${country.toUpperCase()}: ${count} users (case fix needed)`);
                normalizable.push({ original: country, normalized: country.toUpperCase(), count });
            } else {
                // Unknown country
                console.log(`❓ ${country}: ${count} users (unknown country)`);
                unknownCountries.push({ original: country, count, reason: 'Unknown/Unsupported' });
            }
        });

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY ANALYSIS');
        console.log('='.repeat(60));
        console.log(`🎯 Total users: ${totalUsers}`);
        console.log(`✅ Already normalized: ${alreadyNormalized.length} countries (${alreadyNormalized.reduce((sum, item) => sum + item.count, 0)} users)`);
        console.log(`🔄 Can be normalized: ${normalizable.length} countries (${normalizable.reduce((sum, item) => sum + item.count, 0)} users)`);
        console.log(`❓ Unknown/Problematic: ${unknownCountries.length} countries (${unknownCountries.reduce((sum, item) => sum + item.count, 0)} users)`);

        if (normalizable.length > 0) {
            console.log('\n🔄 COUNTRIES THAT CAN BE NORMALIZED:');
            normalizable.forEach(item => {
                console.log(`   "${item.original}" -> "${item.normalized}" (${item.count} users)`);
            });
        }

        if (unknownCountries.length > 0) {
            console.log('\n❓ UNKNOWN/PROBLEMATIC COUNTRIES:');
            unknownCountries.forEach(item => {
                console.log(`   "${item.original}" (${item.count} users) - ${item.reason}`);
            });
        }

        console.log('\n📋 SUPPORTED COUNTRIES:');
        Object.entries(countryDialingCodes).forEach(([iso, code]) => {
            console.log(`   ${iso} (${code})`);
        });

        console.log('\n🔍 SUPPORTED COUNTRY NAME VARIATIONS:');
        Object.entries(countryNameVariations).forEach(([variation, iso]) => {
            console.log(`   "${variation}" -> ${iso}`);
        });

        return { normalizable, unknownCountries, alreadyNormalized, totalUsers };

    } catch (error) {
        console.error('💥 Analysis failed with error:', error);
        throw error;
    }
}

async function fixAllCountries() {
    try {
        console.log('\n🔧 Starting comprehensive country normalization...');

        // Build regex patterns for all known variations
        const variationPatterns = Object.keys(countryNameVariations).map(variation => {
            // Escape special regex characters and create case-insensitive pattern
            const escaped = variation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`^${escaped}$`, 'i');
        });

        // Find all users with countries that can be normalized
        const query = {
            country: { $in: variationPatterns }
        };

        console.log('🔍 Searching for users with normalizable countries...');
        const usersToUpdate = await User.find(query).exec();

        console.log(`📊 Found ${usersToUpdate.length} users with normalizable countries`);

        if (usersToUpdate.length === 0) {
            console.log('✅ No users found to update. All countries already normalized.');
            return;
        }

        // Group by transformation
        const transformations = new Map();
        usersToUpdate.forEach(user => {
            if (user.country) {
                const normalized = normalizeCountryName(user.country);
                const key = `${user.country} -> ${normalized}`;
                if (!transformations.has(key)) {
                    transformations.set(key, { from: user.country, to: normalized, users: [] });
                }
                transformations.get(key).users.push(user._id);
            }
        });

        console.log('\n📋 Planned transformations:');
        transformations.forEach((transformation, key) => {
            console.log(`   ${key}: ${transformation.users.length} users`);
        });

        // Confirm before proceeding
        console.log('\n⚠️  This will update countries for all users shown above.');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');

        await new Promise(resolve => setTimeout(resolve, 5000));

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

        console.log('\n🎉 Country normalization completed!');
        console.log(`📈 Total users processed: ${usersToUpdate.length}`);
        console.log(`✅ Users updated: ${updatedCount}`);
        console.log(`❌ Errors encountered: ${errorCount}`);

        // Verify the updates
        console.log('\n🔍 Verifying normalization...');
        const remainingUsers = await User.find(query).exec();

        if (remainingUsers.length === 0) {
            console.log('✅ Normalization verification successful! All countries normalized.');
        } else {
            console.warn(`⚠️ Normalization incomplete: ${remainingUsers.length} users still have unnormalized countries`);
        }

        // Show final statistics for each supported country
        console.log('\n📊 Final country distribution:');
        const finalStats = await User.aggregate([
            {
                $match: {
                    country: { $in: Object.keys(countryDialingCodes) }
                }
            },
            {
                $group: {
                    _id: '$country',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        finalStats.forEach(stat => {
            console.log(`   ${stat._id}: ${stat.count} users`);
        });

    } catch (error) {
        console.error('💥 Country normalization failed:', error);
        throw error;
    }
}

async function main() {
    try {
        const mode = process.argv[2] || 'analyze';

        if (mode === 'analyze' || mode === 'check') {
            await analyzeCountryData();
        } else if (mode === 'fix') {
            await analyzeCountryData();
            await fixAllCountries();
        } else {
            console.log('Usage:');
            console.log('  node check-all-countries.js analyze    # Just analyze current data');
            console.log('  node check-all-countries.js fix        # Analyze and fix all countries');
            process.exit(1);
        }

    } catch (error) {
        console.error('💥 Script failed:', error);
        process.exit(1);
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Script interrupted by user');
    mongoose.connection.close().then(() => {
        console.log('🔌 MongoDB connection closed');
        process.exit(0);
    });
});

// Run the script
main()
    .then(() => {
        console.log('\n🎊 Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    }); 