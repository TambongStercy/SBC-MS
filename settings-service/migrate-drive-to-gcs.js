require('dotenv').config();

const { MongoClient } = require('mongodb');
const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    // MongoDB - Separate databases for each microservice
    mongodb: {
        users: process.env.MONGODB_URI_PROD?.replace('sbc_settings', 'sbc_users') ||
            'mongodb://localhost:27017/sbc_users',
        settings: process.env.MONGODB_URI_PROD?.replace('sbc_settings', 'sbc_settings') ||
            'mongodb://localhost:27017/sbc_settings',
        products: process.env.MONGODB_URI_PROD?.replace('sbc_settings', 'sbc_products') ||
            'mongodb://localhost:27017/sbc_products'
    },

    // Google Service Account (same as your existing config)
    googleCredentials: {
        client_email: process.env.DRIVE_CLIENT_EMAIL,
        private_key: process.env.DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },

    // Google Drive - Main SBC folder containing all files
    parentFolderId: process.env.DRIVE_SETTINGS_FOLDER_ID || process.env.SBC_FOLDER || '1i6BPoJav9toD0KnLmYBBZldfCRvCOYZy',

    // Google Drive folder structure
    folders: {
        sbc: process.env.SBC_FOLDER || '1i6BPoJav9toD0KnLmYBBZldfCRvCOYZy',      // Main folder
        profilePictures: process.env.PP_FOLDER || '1ZC3NkAeZzTg5ihS3GZAqpfj0pJ4M9-_P', // Profile pictures
        productDocs: process.env.PD_FOLDER || '1fpuKIFCHXqCFyykQErvawDqaeKnE66GR'     // Product images
    },

    // Cloud Storage
    projectId: 'snipper-c0411',
    bucketName: 'sbc-file-storage',

    // Migration settings
    batchSize: 10, // Process 10 files at a time
    dryRun: true, // SAFETY: Set to false only when ready for actual migration
    backupFilePath: './migration-backup.json' // Backup of file mappings
};

class DriveToGCSMigrator {
    constructor() {
        this.driveService = null;
        this.gcsStorage = null;
        this.mongoClients = {
            users: null,
            settings: null,
            products: null
        };
        this.migrationLog = [];
        this.fileMapping = {}; // Old Drive ID -> New GCS URL mapping
    }

    async initialize() {
        console.log('🚀 Initializing migration services...');

        // Initialize Google Drive
        const jwtClient = new google.auth.JWT(
            CONFIG.googleCredentials.client_email,
            null,
            CONFIG.googleCredentials.private_key,
            ['https://www.googleapis.com/auth/drive']
        );
        this.driveService = google.drive({ version: 'v3', auth: jwtClient });

        // Initialize Cloud Storage
        this.gcsStorage = new Storage({
            projectId: CONFIG.projectId,
            credentials: CONFIG.googleCredentials
        });

        // Initialize MongoDB connections for each microservice
        console.log('🔗 Connecting to microservice databases...');
        console.log(`   👤 Users DB: ${CONFIG.mongodb.users}`);
        console.log(`   ⚙️  Settings DB: ${CONFIG.mongodb.settings}`);
        console.log(`   🛍️  Products DB: ${CONFIG.mongodb.products}`);

        this.mongoClients.users = new MongoClient(CONFIG.mongodb.users);
        this.mongoClients.settings = new MongoClient(CONFIG.mongodb.settings);
        this.mongoClients.products = new MongoClient(CONFIG.mongodb.products);

        await Promise.all([
            this.mongoClients.users.connect(),
            this.mongoClients.settings.connect(),
            this.mongoClients.products.connect()
        ]);

        console.log('✅ Connected to all microservice databases');

        // Ensure GCS bucket exists
        await this.ensureBucketExists();

        console.log('✅ All services initialized successfully');
    }

    async ensureBucketExists() {
        try {
            const bucket = this.gcsStorage.bucket(CONFIG.bucketName);
            const [exists] = await bucket.exists();

            if (!exists) {
                console.log(`📦 Creating bucket: ${CONFIG.bucketName}`);
                await this.gcsStorage.createBucket(CONFIG.bucketName, {
                    location: 'US',
                    storageClass: 'STANDARD',
                    uniformBucketLevelAccess: true, // Enable uniform bucket-level access
                });

                console.log(`✅ Bucket created with uniform bucket-level access: ${CONFIG.bucketName}`);
            } else {
                console.log(`✅ Bucket already exists: ${CONFIG.bucketName}`);
            }

            // Set bucket-level IAM policy for public read access
            await this.setBucketPublicPolicy(bucket);
        } catch (error) {
            console.error('❌ Error ensuring bucket exists:', error);
            throw error;
        }
    }

    async setBucketPublicPolicy(bucket) {
        try {
            // Get current IAM policy
            const [policy] = await bucket.iam.getPolicy();

            // Add public read access
            const publicReadBinding = {
                role: 'roles/storage.objectViewer',
                members: ['allUsers'],
            };

            // Check if public read binding already exists
            const existingBinding = policy.bindings?.find(
                (binding) => binding.role === 'roles/storage.objectViewer' &&
                    binding.members?.includes('allUsers')
            );

            if (!existingBinding) {
                if (!policy.bindings) policy.bindings = [];
                policy.bindings.push(publicReadBinding);

                await bucket.iam.setPolicy(policy);
                console.log(`✅ Set bucket IAM policy for public read access: ${CONFIG.bucketName}`);
            } else {
                console.log(`✅ Bucket already has public read access: ${CONFIG.bucketName}`);
            }
        } catch (error) {
            console.warn(`⚠️  Could not set bucket public policy (files may not be publicly accessible): ${error.message}`);
            // Don't throw error - the bucket still works, files just might not be publicly accessible
        }
    }

    async getAllDriveFiles() {
        console.log('📁 Fetching all files from Google Drive folder structure...');
        console.log(`   📂 Main SBC Folder: ${CONFIG.parentFolderId}`);
        console.log(`   👤 Profile Pictures: ${CONFIG.folders.profilePictures}`);
        console.log(`   🛍️  Product Images: ${CONFIG.folders.productDocs}`);

        const allFiles = [];

        // Get files from all relevant folders
        const foldersToCheck = [
            { id: CONFIG.parentFolderId, name: 'SBC_Main', type: 'general' },
            { id: CONFIG.folders.profilePictures, name: 'ProfilePictures', type: 'avatar' },
            { id: CONFIG.folders.productDocs, name: 'ProductImages', type: 'product' }
        ];

        for (const folder of foldersToCheck) {
            console.log(`\n📂 Scanning folder: ${folder.name} (${folder.id})`);
            const folderFiles = await this.getFilesFromFolder(folder.id, folder.type);
            allFiles.push(...folderFiles);
            console.log(`   Found ${folderFiles.length} files in ${folder.name}`);
        }

        console.log(`\n✅ Total files found across all folders: ${allFiles.length}`);
        return allFiles;
    }

    async getFilesFromFolder(folderId, fileType) {
        const files = [];
        let pageToken = null;

        do {
            try {
                const params = {
                    pageSize: 100,
                    fields: 'nextPageToken, files(id, name, mimeType, size, parents)',
                    q: `'${folderId}' in parents and trashed=false`,
                    pageToken: pageToken
                };

                const response = await this.driveService.files.list(params);
                const folderFiles = (response.data.files || []).map(file => ({
                    ...file,
                    folderType: fileType  // Add metadata about which folder this came from
                }));

                files.push(...folderFiles);
                pageToken = response.data.nextPageToken;

            } catch (error) {
                console.error(`❌ Error fetching files from folder ${folderId}:`, error);
                // Continue with other folders even if one fails
                break;
            }
        } while (pageToken);

        return files;
    }

    async migrateFile(driveFile) {
        const { id: driveFileId, name: fileName, mimeType, folderType } = driveFile;

        try {
            // Organize files by folder type for better Cloud Storage structure
            const folderPrefix = this.getFolderPrefix(folderType);
            const gcsFileName = folderPrefix ? `${folderPrefix}/${fileName}` : fileName;

            console.log(`  🔄 Migrating: ${fileName} (${folderType}) → ${gcsFileName}`);

            if (CONFIG.dryRun) {
                console.log(`     [DRY RUN] Would migrate to: ${gcsFileName}`);
                return {
                    success: true,
                    driveFileId,
                    fileName: gcsFileName,
                    originalName: fileName,
                    folderType,
                    gcsUrl: `https://storage.googleapis.com/${CONFIG.bucketName}/${gcsFileName}`,
                    dryRun: true
                };
            }

            // Step 1: Download from Google Drive
            const driveResponse = await this.driveService.files.get({
                fileId: driveFileId,
                alt: 'media'
            }, { responseType: 'arraybuffer' });

            const fileBuffer = Buffer.from(driveResponse.data);
            console.log(`     ⬇️  Downloaded: ${fileName} (${fileBuffer.length} bytes)`);

            // Step 2: Upload to Cloud Storage with organized folder structure
            const bucket = this.gcsStorage.bucket(CONFIG.bucketName);
            const file = bucket.file(gcsFileName);

            await file.save(fileBuffer, {
                metadata: {
                    contentType: mimeType,
                    cacheControl: 'public, max-age=31536000',
                    // Add custom metadata to track original folder
                    originalDriveFolder: folderType,
                    originalFileName: fileName
                },
                // Files will be publicly accessible via bucket-level IAM policy
            });

            const gcsUrl = `https://storage.googleapis.com/${CONFIG.bucketName}/${gcsFileName}`;
            console.log(`     ⬆️  Uploaded to: ${gcsUrl}`);

            return {
                success: true,
                driveFileId,
                fileName: gcsFileName,
                originalName: fileName,
                folderType,
                gcsUrl,
                size: fileBuffer.length
            };

        } catch (error) {
            console.error(`     ❌ Failed to migrate ${fileName}:`, error.message);
            return {
                success: false,
                driveFileId,
                fileName,
                folderType,
                error: error.message
            };
        }
    }

    getFolderPrefix(folderType) {
        switch (folderType) {
            case 'avatar':
                return 'avatars';
            case 'product':
                return 'products';
            case 'general':
                return 'documents';
            default:
                return 'misc';
        }
    }

    async updateDatabaseReferences() {
        console.log('🗃️  Updating database references across microservices...');
        const updates = [];

        // 1. Update User collection in sbc_users database
        console.log('👤 Updating user avatars in sbc_users database...');
        const usersDb = this.mongoClients.users.db('sbc_users');
        const userCollection = usersDb.collection('users');
        const usersWithAvatars = await userCollection.find({ avatarId: { $exists: true, $ne: null } }).toArray();

        for (const user of usersWithAvatars) {
            const oldDriveId = user.avatarId;
            const newGcsUrl = this.fileMapping[oldDriveId];

            if (newGcsUrl) {
                // Extract the full path from GCS URL (e.g., "avatars/filename.jpg")
                const urlParts = newGcsUrl.split('/');
                const gcsFilePath = urlParts.slice(-2).join('/'); // Get folder/filename

                await userCollection.updateOne(
                    { _id: user._id },
                    {
                        $set: {
                            avatar: newGcsUrl,           // CDN URL
                            avatarId: gcsFilePath        // Cloud Storage path (avatars/filename.jpg)
                        }
                    }
                );
                updates.push(`User ${user._id}: avatar migrated to ${gcsFilePath}`);
            }
        }

        // 2. Update Settings collection in sbc_settings database
        console.log('⚙️  Updating settings files in sbc_settings database...');
        const settingsDb = this.mongoClients.settings.db('sbc_settings');
        const settingsCollection = settingsDb.collection('settings');
        const settingsRecords = await settingsCollection.find({}).toArray();

        for (const setting of settingsRecords) {
            let updated = false;
            const updateFields = {};

            // Check each file field in settings model
            const fileFields = ['companyLogo', 'termsAndConditionsPdf', 'presentationVideo', 'presentationPdf'];

            for (const field of fileFields) {
                const fileRef = setting[field];
                if (fileRef && fileRef.fileId) {
                    const newGcsUrl = this.fileMapping[fileRef.fileId];
                    if (newGcsUrl) {
                        // Extract the full path from GCS URL (e.g., "documents/filename.pdf")
                        const urlParts = newGcsUrl.split('/');
                        const gcsFilePath = urlParts.slice(-2).join('/'); // Get folder/filename
                        
                        updateFields[field] = {
                            ...fileRef,
                            fileId: gcsFilePath,        // Cloud Storage path
                            url: newGcsUrl,            // CDN URL
                            storageType: 'gcs'         // Mark as Cloud Storage
                        };
                        updated = true;
                    }
                }
            }

            if (updated) {
                await settingsCollection.updateOne(
                    { _id: setting._id },
                    { $set: updateFields }
                );
                updates.push(`Settings ${setting._id}: file references migrated to Cloud Storage`);
            }
        }

        // 3. Update Product collection in sbc_products database
        console.log('🛍️  Updating product images in sbc_products database...');
        const productsDb = this.mongoClients.products.db('sbc_products');
        const productCollection = productsDb.collection('products');
        const productsWithImages = await productCollection.find({ 'images.fileId': { $exists: true } }).toArray();

        for (const product of productsWithImages) {
            let updated = false;
            const migratedImages = [];

            for (const image of product.images) {
                const newGcsUrl = this.fileMapping[image.fileId];
                if (newGcsUrl) {
                    // Extract the full path from GCS URL (e.g., "products/filename.jpg")
                    const urlParts = newGcsUrl.split('/');
                    const gcsFilePath = urlParts.slice(-2).join('/'); // Get folder/filename
                    
                    migratedImages.push({
                        url: newGcsUrl,           // CDN URL
                        fileId: gcsFilePath       // Cloud Storage path (products/filename.jpg)
                    });
                    updated = true;
                } else {
                    // Keep original image if not migrated
                    migratedImages.push(image);
                }
            }

            if (updated) {
                await productCollection.updateOne(
                    { _id: product._id },
                    { $set: { images: migratedImages } }
                );
                updates.push(`Product ${product._id}: images migrated to Cloud Storage`);
            }
        }

        console.log(`✅ Database updates completed: ${updates.length} records updated across all microservices`);
        return updates;
    }

    async saveMigrationBackup() {
        const backupData = {
            timestamp: new Date().toISOString(),
            migrationLog: this.migrationLog,
            fileMapping: this.fileMapping,
            config: {
                bucketName: CONFIG.bucketName,
                dryRun: CONFIG.dryRun
            }
        };

        fs.writeFileSync(CONFIG.backupFilePath, JSON.stringify(backupData, null, 2));
        console.log(`💾 Migration backup saved: ${CONFIG.backupFilePath}`);
    }

    async migrate() {
        try {
            await this.initialize();

            console.log(`\n🚀 Starting migration (Dry Run: ${CONFIG.dryRun})...`);

            // Get all Drive files
            const driveFiles = await this.getAllDriveFiles();

            if (driveFiles.length === 0) {
                console.log('ℹ️  No files found to migrate');
                return;
            }

            // Process files in batches
            for (let i = 0; i < driveFiles.length; i += CONFIG.batchSize) {
                const batch = driveFiles.slice(i, i + CONFIG.batchSize);
                console.log(`\n📦 Processing batch ${Math.floor(i / CONFIG.batchSize) + 1} (${batch.length} files)...`);

                const batchPromises = batch.map(file => this.migrateFile(file));
                const results = await Promise.allSettled(batchPromises);

                results.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        const migrationResult = result.value;
                        this.migrationLog.push(migrationResult);

                        if (migrationResult.success && migrationResult.gcsUrl) {
                            this.fileMapping[migrationResult.driveFileId] = migrationResult.gcsUrl;
                        }
                    } else {
                        console.error(`❌ Batch error:`, result.reason);
                    }
                });

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Update database references
            if (!CONFIG.dryRun && Object.keys(this.fileMapping).length > 0) {
                await this.updateDatabaseReferences();
            }

            // Save backup
            await this.saveMigrationBackup();

            // Summary
            const successful = this.migrationLog.filter(log => log.success).length;
            const failed = this.migrationLog.filter(log => !log.success).length;

            console.log(`\n✅ Migration completed!`);
            console.log(`   📊 Successful: ${successful}`);
            console.log(`   ❌ Failed: ${failed}`);
            console.log(`   📝 Total: ${this.migrationLog.length}`);

            if (CONFIG.dryRun) {
                console.log(`\n⚠️  This was a DRY RUN. To actually migrate files, set dryRun: false`);
            }

        } catch (error) {
            console.error('💥 Migration failed:', error);
            throw error;
        } finally {
            // Close all MongoDB connections
            const closePromises = Object.values(this.mongoClients)
                .filter(client => client !== null)
                .map(client => client.close());

            if (closePromises.length > 0) {
                await Promise.all(closePromises);
                console.log('🔌 All database connections closed');
            }
        }
    }
}

// Run migration if this script is executed directly
if (require.main === module) {
    const migrator = new DriveToGCSMigrator();
    migrator.migrate().catch(console.error);
}

module.exports = DriveToGCSMigrator; 