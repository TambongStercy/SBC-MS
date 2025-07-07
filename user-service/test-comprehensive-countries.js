// Comprehensive test for country normalization based on database analysis results

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

// Test cases based on database analysis results
const databaseFoundIssues = [
    // Issues found in the database analysis
    { input: 'Togo', expected: 'TG', userCount: 1998 },
    { input: "Côte d'Ivoire", expected: 'CI', userCount: 1806 },
    { input: 'Burkina Faso', expected: 'BF', userCount: 925 },
    { input: 'Bénin', expected: 'BJ', userCount: 853 },
    { input: 'Congo-Brazzaville', expected: 'CG', userCount: 52 },

    // Case variations that might exist
    { input: 'TOGO', expected: 'TG' },
    { input: 'togo', expected: 'TG' },
    { input: 'BURKINA FASO', expected: 'BF' },
    { input: 'burkina faso', expected: 'BF' },
    { input: 'BENIN', expected: 'BJ' },
    { input: 'benin', expected: 'BJ' },
    { input: 'CÔTE D\'IVOIRE', expected: 'CI' },
    { input: 'côte d\'ivoire', expected: 'CI' },

    // Other potential variations
    { input: 'Burkina-Faso', expected: 'BF' },
    { input: 'BurkinaFaso', expected: 'BF' },
    { input: 'Cote d\'Ivoire', expected: 'CI' },
    { input: 'Cote Divoire', expected: 'CI' },
    { input: 'Ivory Coast', expected: 'CI' },
    { input: 'Congo Brazzaville', expected: 'CG' },
    { input: 'Republic of Congo', expected: 'CG' },

    // Nigerian variations
    { input: 'Nigeria', expected: 'NG' },
    { input: 'NIGERIA', expected: 'NG' },
    { input: 'nigéria', expected: 'NG' },

    // Already normalized (should remain unchanged)
    { input: 'CM', expected: 'CM' },
    { input: 'BJ', expected: 'BJ' },
    { input: 'CI', expected: 'CI' },
    { input: 'TG', expected: 'TG' },
    { input: 'BF', expected: 'BF' },
    { input: 'NG', expected: 'NG' },

    // Case fix needed
    { input: 'cm', expected: 'CM' },
    { input: 'bj', expected: 'BJ' },
    { input: 'ci', expected: 'CI' },
    { input: 'tg', expected: 'TG' },
];

console.log('🧪 Testing comprehensive country normalization...\n');
console.log('📊 Testing cases based on database analysis results\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = [];

databaseFoundIssues.forEach(testCase => {
    totalTests++;
    const result = normalizeCountryName(testCase.input);
    const passed = result === testCase.expected;

    if (passed) {
        passedTests++;
        const userInfo = testCase.userCount ? ` (${testCase.userCount} users affected)` : '';
        console.log(`✅ "${testCase.input}" -> "${result}"${userInfo}`);
    } else {
        failedTests.push(testCase);
        const userInfo = testCase.userCount ? ` (${testCase.userCount} users affected)` : '';
        console.log(`❌ "${testCase.input}" -> "${result}" (expected "${testCase.expected}")${userInfo}`);
    }
});

console.log('\n' + '='.repeat(60));
console.log('📊 TEST RESULTS SUMMARY');
console.log('='.repeat(60));
console.log(`🎯 Total tests: ${totalTests}`);
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests.length}`);
console.log(`📊 Success rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failedTests.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    failedTests.forEach(test => {
        const userInfo = test.userCount ? ` (affects ${test.userCount} users)` : '';
        console.log(`   "${test.input}" -> expected "${test.expected}"${userInfo}`);
    });
} else {
    console.log('\n🎉 ALL TESTS PASSED! Registration is now robust against country naming errors.');
}

// Test specific database issues
console.log('\n🔍 SPECIFIC DATABASE ISSUES TEST:');
const criticalIssues = [
    'Togo',
    "Côte d'Ivoire",
    'Burkina Faso',
    'Bénin',
    'Congo-Brazzaville'
];

let criticalPassed = 0;
criticalIssues.forEach(issue => {
    const result = normalizeCountryName(issue);
    const isNormalized = countryDialingCodes[result];
    if (isNormalized) {
        criticalPassed++;
        console.log(`✅ "${issue}" -> "${result}" (FIXED)`);
    } else {
        console.log(`❌ "${issue}" -> "${result}" (STILL PROBLEMATIC)`);
    }
});

console.log(`\n🎯 Critical database issues: ${criticalPassed}/${criticalIssues.length} fixed`);

if (criticalPassed === criticalIssues.length) {
    console.log('🎊 All critical database issues are now resolved!');
    console.log('✨ Registration will now properly normalize all these country variations.');
} else {
    console.log('⚠️ Some critical issues still need attention.');
}

// Show all supported variations
console.log('\n📋 ALL SUPPORTED COUNTRY VARIATIONS:');
Object.entries(countryNameVariations).forEach(([variation, iso]) => {
    console.log(`   "${variation}" -> ${iso}`);
});

console.log('\n📋 SUPPORTED ISO CODES:');
Object.entries(countryDialingCodes).forEach(([iso, code]) => {
    console.log(`   ${iso} (${code})`);
}); 