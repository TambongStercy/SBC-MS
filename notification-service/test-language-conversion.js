#!/usr/bin/env node

// Test script to verify language conversion functionality
const { convertLanguageCode, getOtpTemplateConfig } = require('./src/utils/otp-template.config');

console.log('🌍 Language Conversion Test\n');

const testCases = [
    // Simple language codes
    { input: 'en', expected: 'en_US', description: 'Simple English' },
    { input: 'fr', expected: 'fr', description: 'Simple French' },
    { input: 'es', expected: 'en_US', description: 'Spanish (fallback to English)' },
    { input: 'de', expected: 'en_US', description: 'German (fallback to English)' },

    // Full locale codes
    { input: 'en_GB', expected: 'en_US', description: 'British English' },
    { input: 'fr_CA', expected: 'fr', description: 'Canadian French' },
    { input: 'es_ES', expected: 'en_US', description: 'Spain Spanish' },

    // Mixed case and variations
    { input: 'EN', expected: 'en_US', description: 'Uppercase English' },
    { input: 'French', expected: 'fr', description: 'Full word French' },
    { input: 'english', expected: 'en_US', description: 'Lowercase full word' },

    // Edge cases
    { input: undefined, expected: 'en_US', description: 'Undefined language' },
    { input: '', expected: 'en_US', description: 'Empty string' },
    { input: 'xyz', expected: 'en_US', description: 'Unknown language code' },
    { input: 'zh-CN', expected: 'en_US', description: 'Chinese (unsupported, fallback)' },
];

console.log('Language Code Conversion Results:');
console.log('=====================================');

testCases.forEach((testCase, index) => {
    const result = convertLanguageCode(testCase.input);
    const success = result === testCase.expected;
    const icon = success ? '✅' : '❌';

    console.log(`${icon} ${index + 1}. ${testCase.description}`);
    console.log(`   Input: "${testCase.input}" → Output: "${result}" (Expected: "${testCase.expected}")`);

    if (!success) {
        console.log(`   ⚠️  MISMATCH: Expected "${testCase.expected}" but got "${result}"`);
    }
    console.log('');
});

console.log('\nTemplate Configuration Examples:');
console.log('================================');

const exampleLanguages = ['en', 'fr', 'es', 'de', undefined];
exampleLanguages.forEach(lang => {
    const config = getOtpTemplateConfig(lang);
    console.log(`Language: "${lang || 'undefined'}" → Template: "${config.templateName}" (${config.languageCode})`);
});

console.log('\n📋 Summary:');
console.log('- Simple codes like "en", "fr" are converted to available template languages');
console.log('- Unsupported languages fallback to English (en_US)');
console.log('- Case-insensitive and handles various formats (en_GB, en-US, etc.)');
console.log('- French variants → fr template, English variants → en_US template'); 