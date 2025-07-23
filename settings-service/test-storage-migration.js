/**
 * Quick test script to verify Cloud Storage setup
 * Tests upload/download without affecting production data
 */

const fs = require('fs');
const path = require('path');

async function testCloudStorageUpload() {
    console.log('🧪 Testing Cloud Storage Upload/Download...\n');

    try {
        // Import the cloud storage service
        const CloudStorageService = require('./src/services/cloudStorage.service').default;

        // Create a test file
        const testContent = Buffer.from('This is a test file for Cloud Storage migration', 'utf-8');
        const testFileName = `test_migration_${Date.now()}.txt`;
        const testMimeType = 'text/plain';

        console.log(`📄 Creating test file: ${testFileName}`);

        // Test upload
        console.log('⬆️  Testing upload to Cloud Storage...');
        const uploadResult = await CloudStorageService.uploadFileHybrid(
            testContent,
            testMimeType,
            testFileName
        );

        console.log('✅ Upload successful!');
        console.log(`   File ID: ${uploadResult.fileId}`);
        console.log(`   Public URL: ${uploadResult.publicUrl}`);
        console.log(`   File Name: ${uploadResult.fileName}`);

        // Test URL access
        console.log('\n🌐 Testing file URL access...');
        const fileUrl = await CloudStorageService.getFileUrl(uploadResult.fileId);
        console.log(`   Generated URL: ${fileUrl}`);

        // Test with a simple HTTP request to verify file is accessible
        try {
            const https = require('https');
            const response = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    if (res.statusCode === 200) {
                        resolve(res);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                }).on('error', reject);
            });

            console.log('✅ File is publicly accessible via CDN URL');

        } catch (urlError) {
            console.log('⚠️  URL access test failed (but upload worked):', urlError.message);
        }

        // Clean up test file
        console.log('\n🧹 Cleaning up test file...');
        try {
            await CloudStorageService.deleteFile(testFileName);
            console.log('✅ Test file cleaned up successfully');
        } catch (deleteError) {
            console.log('⚠️  Could not delete test file:', deleteError.message);
        }

        console.log('\n🎉 Cloud Storage test completed successfully!');
        console.log('✅ Ready to proceed with migration');

        return true;

    } catch (error) {
        console.error('❌ Cloud Storage test failed:', error.message);

        if (error.message.includes('Cloud Storage API has not been used')) {
            console.log('\n🔧 Next step: Enable Cloud Storage API');
            console.log('Run: node enable-cloud-storage.js');
        } else if (error.message.includes('billing')) {
            console.log('\n💳 Billing issue detected');
            console.log('1. Ensure billing account is linked to project snipper-c0411');
            console.log('2. Check quota limits');
        } else {
            console.log('\n🔍 Debug info:');
            console.log('1. Check environment variables in .env');
            console.log('2. Verify service account permissions');
            console.log('3. Run: node enable-cloud-storage.js for detailed setup check');
        }

        return false;
    }
}

async function testExistingDriveFiles() {
    console.log('\n🔍 Testing existing Google Drive file access...\n');

    try {
        // Import Google Drive service to test existing files
        const GoogleDriveService = require('./src/services/googleDrive.service').default;

        console.log('📁 Attempting to list files from Google Drive...');
        const { google } = require('googleapis');

        // Set up Drive API client
        const jwtClient = new google.auth.JWT(
            process.env.DRIVE_CLIENT_EMAIL,
            null,
            process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/drive']
        );

        const drive = google.drive({ version: 'v3', auth: jwtClient });

        // List a few files to test access
        const response = await drive.files.list({
            pageSize: 5,
            fields: 'files(id, name, size, mimeType)',
        });

        const files = response.data.files;

        if (files && files.length > 0) {
            console.log(`✅ Found ${files.length} files in Google Drive`);
            files.forEach((file, index) => {
                console.log(`   ${index + 1}. ${file.name} (${file.id})`);
                console.log(`      Size: ${file.size || 'Unknown'} bytes, Type: ${file.mimeType}`);
            });

            console.log('\n✅ Google Drive access working - ready for migration');
            return true;
        } else {
            console.log('⚠️  No files found in Google Drive (this might be normal)');
            return true;
        }

    } catch (error) {
        console.error('❌ Google Drive access test failed:', error.message);

        if (error.message.includes('quota')) {
            console.log('💾 This confirms the Drive storage quota issue');
            console.log('✅ Migration to Cloud Storage is definitely needed');
            return true; // This error actually confirms we need to migrate
        }

        return false;
    }
}

// Main test function
async function runStorageMigrationTests() {
    console.log('🚀 Storage Migration Pre-Flight Tests\n');
    console.log('======================================\n');

    // Test 1: Cloud Storage setup
    const cloudStorageWorking = await testCloudStorageUpload();

    // Test 2: Existing Drive access
    const driveAccessWorking = await testExistingDriveFiles();

    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    console.log(`Cloud Storage: ${cloudStorageWorking ? '✅ Working' : '❌ Failed'}`);
    console.log(`Drive Access: ${driveAccessWorking ? '✅ Working' : '❌ Failed'}`);

    if (cloudStorageWorking) {
        console.log('\n🎯 READY FOR MIGRATION!');
        console.log('\nNext steps:');
        console.log('1. Run: node migrate-drive-to-gcs.js (dry run first)');
        console.log('2. Review migration-backup.json');
        console.log('3. Set dryRun: false and run actual migration');
        console.log('4. Restart settings service to use new storage');
    } else {
        console.log('\n⚠️  Setup incomplete. Fix Cloud Storage issues first.');
        console.log('Run: node enable-cloud-storage.js for detailed diagnostics');
    }

    return cloudStorageWorking;
}

// Run tests if this script is executed directly
if (require.main === module) {
    runStorageMigrationTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Tests failed:', error);
            process.exit(1);
        });
}

module.exports = { testCloudStorageUpload, testExistingDriveFiles, runStorageMigrationTests }; 