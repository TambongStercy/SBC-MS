// Debug script to test template selection logic
const { getOtpTemplateConfig } = require('./src/utils/otp-template.config.ts');

console.log('🔍 Testing Template Selection Logic\n');

const testCases = [
    { language: 'fr', expected: 'connexionfr' },
    { language: 'en_US', expected: 'connexion' },
    { language: 'en', expected: 'connexion' },
    { language: undefined, expected: 'connexion' },
    { language: null, expected: 'connexion' },
    { language: 'es', expected: 'connexion' }, // Should fallback
];

testCases.forEach(testCase => {
    const config = getOtpTemplateConfig(testCase.language);
    const match = config.templateName === testCase.expected ? '✅' : '❌';
    
    console.log(`${match} Language: "${testCase.language}" → Template: "${config.templateName}" (Expected: "${testCase.expected}")`);
});

console.log('\n📋 Full Template Configuration:');
console.log({
    en_US: getOtpTemplateConfig('en_US'),
    fr: getOtpTemplateConfig('fr'),
    en: getOtpTemplateConfig('en'),
    default: getOtpTemplateConfig()
}); 