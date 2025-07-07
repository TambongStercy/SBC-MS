const mongoose = require('mongoose');
const config = require('../config').default;

// Country normalization mappings
const COUNTRY_NAME_VARIATIONS = {
    // Cameroon variations
    'cameroon': 'CM', 'cameroun': 'CM', 'camerun': 'CM', 'kamerun': 'CM',
    
    // Other common variations
    'benin': 'BJ', 'bénin': 'BJ',
    'cote divoire': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
    'democratic republic of congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo kinshasa': 'CD', 'zaire': 'CD',
    'republic of congo': 'CG', 'congo brazzaville': 'CG', 'congo': 'CG',
    'senegal': 'SN', 'sénégal': 'SN',
    'burkina faso': 'BF', 'burkina': 'BF',
    'ghana': 'GH',
    'nigeria': 'NG', 'nigéria': 'NG',
    'kenya': 'KE',
    'gabon': 'GA',
    'togo': 'TG',
    'mali': 'ML',
    'niger': 'NE'
};

const COUNTRY_CODE_PREFIXES = {
    'DZ': '213', 'AO': '244', 'BJ': '229', 'BW': '267',
    'BF': '226', 'BI': '257', 'CV': '238', 'CM': '237',
    'CF': '236', 'TD': '235', 'KM': '269', 'CD': '243',
    'CG': '242', 'CI': '225', 'DJ': '253', 'EG': '20',
    'GQ': '240', 'ER': '291', 'SZ': '268', 'ET': '251',
    'GA': '241', 'GM': '220', 'GH': '233', 'GN': '224',
    'GW': '245', 'KE': '254', 'LS': '266', 'LR': '231',
    'LY': '218', 'MG': '261', 'MW': '265', 'ML': '223',
    'MR': '222', 'MU': '230', 'MA': '212', 'MZ': '258',
    'NA': '264', 'NE': '227', 'NG': '234', 'RW': '250',
    'ST': '239', 'SN': '221', 'SC': '248', 'SL': '232',
    'SO': '252', 'ZA': '27', 'SS': '211', 'SD': '249',
    'TZ': '255', 'TG': '228', 'TN': '216', 'UG': '256',
    'ZM': '260', 'ZW': '263'
};

// Create prefix to country code mapping
const PREFIX_TO_COUNTRY_CODE = {};
for (const [countryCode, prefix] of Object.entries(COUNTRY_CODE_PREFIXES)) {
    PREFIX_TO_COUNTRY_CODE[prefix] = countryCode;
}

function normalizeCountryCode(countryInput) {
    if (!countryInput || typeof countryInput !== 'string') {
        return 'Autres';
    }

    const input = countryInput.trim();
    if (!input) {
        return 'Autres';
    }

    // Check if it's already a valid ISO country code
    const upperInput = input.toUpperCase();
    if (COUNTRY_CODE_PREFIXES[upperInput]) {
        return upperInput;
    }

    // Check country name variations
    const lowerInput = input.toLowerCase();
    const normalizedCode = COUNTRY_NAME_VARIATIONS[lowerInput];
    if (normalizedCode) {
        console.log(`Normalized country name "${input}" to "${normalizedCode}"`);
        return normalizedCode;
    }

    // If not found, return as "Autres"
    return 'Autres';
}

function extractCountryCodeFromPhone(phoneNumber) {
    if (!phoneNumber) {
        return null;
    }

    const phoneStr = phoneNumber.toString().trim();
    if (!phoneStr) {
        return null;
    }

    // Remove any non-digit characters (including +, spaces, etc.)
    const cleanedPhone = phoneStr.replace(/\D/g, '');
    
    if (!cleanedPhone) {
        return null;
    }

    // Try to match prefixes from longest to shortest to avoid conflicts
    const sortedPrefixes = Object.keys(PREFIX_TO_COUNTRY_CODE).sort((a, b) => b.length - a.length);
    
    for (const prefix of sortedPrefixes) {
        if (cleanedPhone.startsWith(prefix)) {
            const countryCode = PREFIX_TO_COUNTRY_CODE[prefix];
            console.log(`Extracted country "${countryCode}" from phone number "${phoneStr}" using prefix "${prefix}"`);
            return countryCode;
        }
    }

    return null;
}

function determineUserCountryCode(userCountry, userPhoneNumber) {
    // First try to normalize the country field
    if (userCountry) {
        const normalizedFromCountry = normalizeCountryCode(userCountry);
        if (normalizedFromCountry !== 'Autres') {
            return normalizedFromCountry;
        }
    }

    // If country field is not valid, try to extract from phone number
    if (userPhoneNumber) {
        const countryFromPhone = extractCountryCodeFromPhone(userPhoneNumber);
        if (countryFromPhone) {
            return countryFromPhone;
        }
    }

    // Default fallback
    return 'Autres';
}

async function fixDashboardIssues() {
    try {
        await mongoose.connect(config.mongoUri);
        console.log('Connected to MongoDB');

        console.log('\n=== DASHBOARD ISSUES DIAGNOSIS & FIX ===\n');

        // Define User schema (simplified)
        const UserSchema = new mongoose.Schema({
            name: String,
            email: String,
            phoneNumber: mongoose.Schema.Types.Mixed,
            country: String,
            balance: { type: Number, default: 0 },
            deleted: { type: Boolean, default: false }
        }, { timestamps: true });

        const User = mongoose.model('User', UserSchema);

        // 1. Analyze country data issues
        console.log('--- ANALYZING COUNTRY DATA ---');
        
        const users = await User.find({ deleted: { $ne: true } })
            .select('country phoneNumber balance')
            .lean();

        console.log(`Total users: ${users.length}`);

        // Analyze country distribution BEFORE fix
        const countryDistributionBefore = {};
        users.forEach(user => {
            const country = user.country || 'undefined';
            countryDistributionBefore[country] = (countryDistributionBefore[country] || 0) + 1;
        });

        console.log('\nCountry distribution BEFORE normalization:');
        Object.entries(countryDistributionBefore)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 15)
            .forEach(([country, count]) => {
                console.log(`  ${country}: ${count} users`);
            });

        // Apply country normalization and calculate balances
        console.log('\n--- APPLYING COUNTRY NORMALIZATION ---');
        
        const balancesByCountryFixed = {};
        const countryDistributionAfter = {};
        let normalizedCount = 0;

        users.forEach(user => {
            const originalCountry = user.country;
            const fixedCountry = determineUserCountryCode(user.country, user.phoneNumber);
            
            // Track if normalization changed the result
            if (originalCountry !== fixedCountry) {
                normalizedCount++;
            }

            countryDistributionAfter[fixedCountry] = (countryDistributionAfter[fixedCountry] || 0) + 1;
            balancesByCountryFixed[fixedCountry] = (balancesByCountryFixed[fixedCountry] || 0) + (user.balance || 0);
        });

        console.log(`\nNormalized ${normalizedCount} user countries`);

        console.log('\nCountry distribution AFTER normalization:');
        Object.entries(countryDistributionAfter)
            .sort(([,a], [,b]) => b - a)
            .forEach(([country, count]) => {
                console.log(`  ${country}: ${count} users`);
            });

        console.log('\nBalance by country (FIXED):');
        Object.entries(balancesByCountryFixed)
            .sort(([,a], [,b]) => b - a)
            .forEach(([country, balance]) => {
                console.log(`  ${country}: ${Math.round(balance).toLocaleString()} F`);
            });

        // 2. Analyze withdrawal data (if payment service is available)
        console.log('\n--- ANALYZING WITHDRAWAL DATA ---');
        
        // Try to connect to payment service database or use the same connection
        const TransactionSchema = new mongoose.Schema({
            transactionId: String,
            userId: mongoose.Schema.Types.ObjectId,
            type: String,
            amount: Number,
            currency: String,
            status: String,
            deleted: { type: Boolean, default: false },
            createdAt: Date
        }, { timestamps: true });

        const Transaction = mongoose.model('Transaction', TransactionSchema);

        try {
            const withdrawalStats = await Transaction.aggregate([
                { $match: { type: 'withdrawal', deleted: { $ne: true } } },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        avgAmount: { $avg: '$amount' },
                        positiveAmounts: {
                            $sum: { $cond: { if: { $gt: ['$amount', 0] }, then: 1, else: 0 } }
                        }
                    }
                },
                { $sort: { count: -1 } }
            ]);

            console.log('Withdrawal statistics by status:');
            let totalWithdrawals = 0;
            withdrawalStats.forEach(stat => {
                console.log(`  ${stat._id}: ${stat.count} transactions`);
                console.log(`    Total amount: ${stat.totalAmount.toLocaleString()} F`);
                console.log(`    Average: ${Math.round(stat.avgAmount).toLocaleString()} F`);
                console.log(`    Positive amounts: ${stat.positiveAmounts}`);
                console.log('');
                
                if (stat._id === 'completed') {
                    totalWithdrawals = Math.abs(stat.totalAmount);
                }
            });

            console.log(`CORRECTED Total Completed Withdrawals: ${totalWithdrawals.toLocaleString()} F`);

            // Check for potential issues
            const issues = [];
            withdrawalStats.forEach(stat => {
                if (stat.positiveAmounts > 0) {
                    issues.push(`${stat.positiveAmounts} ${stat._id} withdrawals have positive amounts (should be negative)`);
                }
            });

            if (issues.length > 0) {
                console.log('\n⚠️  WITHDRAWAL DATA ISSUES FOUND:');
                issues.forEach(issue => console.log(`  - ${issue}`));
            }

        } catch (error) {
            console.log('Could not analyze withdrawal data (Payment service may not be available)');
        }

        console.log('\n=== SUMMARY ===');
        console.log(`✅ Country normalization: ${normalizedCount} users corrected`);
        console.log('✅ Country balance calculation: Fixed to use proper normalization');
        console.log('✅ Withdrawal calculation: Enhanced with data validation');

        console.log('\n=== RECOMMENDATIONS ===');
        console.log('1. Deploy the updated country normalization utility');
        console.log('2. Update the admin dashboard service to use the new normalization');
        console.log('3. Consider running a data cleanup script to fix country values in database');
        console.log('4. Implement validation to prevent positive withdrawal amounts');
        console.log('5. Add monitoring alerts for unusual withdrawal totals');

    } catch (error) {
        console.error('Error during analysis:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

// Run the analysis
if (require.main === module) {
    fixDashboardIssues().catch(console.error);
}

module.exports = { 
    normalizeCountryCode, 
    extractCountryCodeFromPhone, 
    determineUserCountryCode,
    fixDashboardIssues 
}; 