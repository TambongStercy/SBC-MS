const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

async function testStorageMonitor() {
    console.log('🔍 Testing Cloud Storage Access...\n');

    // Check environment variables
    console.log('📋 Environment Variables:');
    console.log('DRIVE_CLIENT_EMAIL:', process.env.DRIVE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
    console.log('DRIVE_PRIVATE_KEY:', process.env.DRIVE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
    console.log('GOOGLE_CLOUD_PROJECT_ID:', process.env.GOOGLE_CLOUD_PROJECT_ID ? '✅ Set' : '❌ Missing');
    console.log('CLOUD_STORAGE_BUCKET_NAME:', process.env.CLOUD_STORAGE_BUCKET_NAME || 'sbc-file-storage (default)');
    console.log('');

    try {
        // Test Cloud Storage connection
        console.log('🔧 Testing Cloud Storage Connection...');
        
        const storage = new Storage({
            credentials: {
                client_email: process.env.DRIVE_CLIENT_EMAIL,
                private_key: process.env.DRIVE_PRIVATE_KEY,
            },
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        });

        const bucketName = process.env.CLOUD_STORAGE_BUCKET_NAME || 'sbc-file-storage';
        console.log(`📦 Using bucket: ${bucketName}`);

        const bucket = storage.bucket(bucketName);
        
        // Check if bucket exists
        console.log('📦 Checking bucket existence...');
        const [exists] = await bucket.exists();
        console.log('Bucket exists:', exists ? '✅ Yes' : '❌ No');

        if (!exists) {
            console.log('❌ Bucket does not exist! This is the main issue.');
            console.log('💡 You need to create the bucket first or check the bucket name.');
            return;
        }

        // Test getting files (this is what the storage monitor does)
        console.log('📁 Testing file listing (this is what causes the hang)...');
        
        // Set a timeout to prevent hanging
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout after 10 seconds')), 10000)
        );

        const getFiles = bucket.getFiles({ maxResults: 10 });
        
        const [files] = await Promise.race([getFiles, timeout]);
        
        console.log(`✅ Successfully retrieved ${files.length} files from bucket`);
        console.log('📊 Sample files:');
        files.slice(0, 3).forEach(file => {
            console.log(`  - ${file.name}`);
        });

        console.log('\n✅ Storage monitor should work correctly!');

    } catch (error) {
        console.error('\n❌ Error testing storage monitor:', error.message);
        
        if (error.message.includes('Timeout')) {
            console.log('\n💡 The API is hanging because bucket.getFiles() is taking too long.');
            console.log('   This could be due to:');
            console.log('   1. Network connectivity issues');
            console.log('   2. Incorrect credentials');
            console.log('   3. Bucket permissions');
        } else if (error.message.includes('permission')) {
            console.log('\n💡 Permission issue. Check:');
            console.log('   1. Service account has Storage Object Viewer role');
            console.log('   2. Bucket permissions are correctly configured');
        } else if (error.message.includes('not found')) {
            console.log('\n💡 Bucket or project not found. Check:');
            console.log('   1. Bucket name is correct');
            console.log('   2. Project ID is correct');
            console.log('   3. Service account belongs to the right project');
        }
    }
}

testStorageMonitor().catch(console.error); 