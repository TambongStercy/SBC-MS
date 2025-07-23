/**
 * Script to check and enable Google Cloud Storage API
 * Run this before starting the migration
 */

require('dotenv').config();

const { Storage } = require('@google-cloud/storage');

async function checkCloudStorageAPI() {
    console.log('🔍 Checking Google Cloud Storage API status...');

    try {
        // Use environment variables like the main service
        const storage = new Storage({
            projectId: 'snipper-c0411',
            credentials: {
                client_email: process.env.DRIVE_CLIENT_EMAIL,
                private_key: process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }
        });

        // Try to list buckets to test API access
        console.log('📡 Testing Cloud Storage API access...');
        const [buckets] = await storage.getBuckets();

        console.log('✅ Cloud Storage API is working!');
        console.log(`📦 Found ${buckets.length} buckets in project 'snipper-c0411'`);

        // Check if our target bucket exists
        const targetBucket = 'sbc-file-storage';
        const bucket = storage.bucket(targetBucket);
        const [exists] = await bucket.exists();

        if (exists) {
            console.log(`✅ Target bucket '${targetBucket}' already exists`);
        } else {
            console.log(`⚠️  Target bucket '${targetBucket}' does not exist - will be created automatically`);
        }

        return true;

    } catch (error) {
        console.error('❌ Cloud Storage API Error:', error.message);

        if (error.message.includes('Cloud Storage API has not been used')) {
            console.log('\n🔧 SOLUTION: Enable Cloud Storage API');
            console.log('1. Go to: https://console.cloud.google.com/apis/library/storage-component.googleapis.com?project=snipper-c0411');
            console.log('2. Click "ENABLE" button');
            console.log('3. Wait 1-2 minutes for activation');
            console.log('4. Re-run this script to verify');
        } else if (error.message.includes('billing')) {
            console.log('\n💳 BILLING: Ensure billing is enabled for project snipper-c0411');
            console.log('1. Go to: https://console.cloud.google.com/billing/linkedaccount?project=snipper-c0411');
            console.log('2. Link a billing account if not already linked');
        } else if (error.message.includes('credentials') || error.message.includes('authentication')) {
            console.log('\n🔑 CREDENTIALS: Check your service account credentials');
            console.log('1. Verify GOOGLE_DRIVE_CLIENT_EMAIL is set');
            console.log('2. Verify GOOGLE_DRIVE_PRIVATE_KEY is set');
            console.log('3. Ensure the service account has Storage Admin permissions');
        }

        return false;
    }
}

async function enableCloudStorageSetup() {
    console.log('🚀 Google Cloud Storage Setup Checker\n');

    // Check environment variables
    const clientEmail = process.env.DRIVE_CLIENT_EMAIL;
    const privateKey = process.env.DRIVE_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
        console.error('❌ Missing environment variables:');
        if (!clientEmail) console.error('   - DRIVE_CLIENT_EMAIL');
        if (!privateKey) console.error('   - DRIVE_PRIVATE_KEY');
        console.log('\n🔧 Solution: Check your .env file in settings-service/');
        return false;
    }

    console.log(`✅ Service Account: ${clientEmail}`);
    console.log(`✅ Private Key: ${privateKey.substring(0, 50)}...`);

    // Test API access
    const apiWorking = await checkCloudStorageAPI();

    if (apiWorking) {
        console.log('\n🎉 All checks passed! Ready for migration.');
        console.log('\nNext steps:');
        console.log('1. Run: node migrate-drive-to-gcs.js (for dry run)');
        console.log('2. Check migration-backup.json results');
        console.log('3. Set dryRun: false and run again for actual migration');
    } else {
        console.log('\n❌ Setup incomplete. Please resolve the above issues first.');
    }

    return apiWorking;
}

// Run the setup check
if (require.main === module) {
    enableCloudStorageSetup()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Setup check failed:', error);
            process.exit(1);
        });
}

module.exports = { checkCloudStorageAPI, enableCloudStorageSetup }; 