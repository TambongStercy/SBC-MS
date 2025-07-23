# 🚀 Google Drive to Cloud Storage Migration Plan

## 📋 **Current System Analysis**

### **Current File Storage:**
- **Google Drive**: 15GB limit reached ❌
- **Access Method**: Proxy via `/api/settings/files/:fileId`
- **File References**: Stored as `fileId` in database models

### **Current Models & File References:**

#### **1. User Model (`user-service`)**
```typescript
// Current fields:
avatar?: string;        // Proxy URL (e.g., "/api/settings/files/1ABC...")  
avatarId?: string;     // Google Drive fileId (e.g., "1ABC...")
```

#### **2. Settings Model (`settings-service`)**
```typescript
// Current IFileReference interface:
interface IFileReference {
    fileId: string;     // Google Drive File ID
    url?: string;       // Dynamically generated proxy URL
    fileName?: string;  // Original filename
    mimeType?: string;  // File MIME type
    size?: number;      // File size in bytes
}
```

#### **3. Product Model (`product-service`)**
```typescript
// Current IProductImage interface:
interface IProductImage {
    url: string;    // Proxy URL to access the image
    fileId: string; // Google Drive file ID
}
```

## 🎯 **Migration Goals**

1. ✅ **Unlimited Storage**: Move to Google Cloud Storage (no 15GB limit)
2. ✅ **CDN Performance**: Direct CDN URLs instead of proxy endpoints
3. ✅ **Cost Optimization**: ~$0.40/month instead of $6+/month
4. ✅ **Backward Compatibility**: Support both old Drive files and new Cloud Storage files during transition
5. ✅ **Zero Downtime**: Seamless migration without service interruption

## 🗓️ **Migration Timeline (3-4 Days)**

### **Phase 1: Setup & Preparation (Day 1 - 4 hours)**
- ✅ Enable Google Cloud Storage API
- ✅ Create storage buckets with CDN
- ✅ Update models to support dual formats
- ✅ Implement hybrid file access system

### **Phase 2: New Uploads to Cloud Storage (Day 1-2 - 2 hours)**
- ✅ Route all new uploads to Cloud Storage
- ✅ Return CDN URLs for new files
- ✅ Maintain proxy support for existing Drive files

### **Phase 3: Batch Migration (Day 2-3 - 8 hours)**
- ✅ Create migration script for existing files
- ✅ Transfer Drive files to Cloud Storage
- ✅ Update database references to CDN URLs
- ✅ Verify file accessibility

### **Phase 4: Cleanup (Day 4 - 2 hours)**
- ✅ Remove proxy endpoints (optional)
- ✅ Clean up old Drive files
- ✅ Performance testing

## 🛠️ **Technical Implementation**

### **Step 1: Enhanced Cloud Storage Service**

```typescript
// settings-service/src/services/cloudStorage.service.ts
export class CloudStorageService {
    private storage: Storage;
    private bucketName = 'sbc-files';
    private cdnDomain = 'https://cdn.sniperbusinesscenter.com'; // Your CDN domain

    // Generate CDN URL for better performance
    getCdnUrl(fileName: string): string {
        return `${this.cdnDomain}/${fileName}`;
    }

    // Upload with organized folder structure
    async uploadFile(fileBuffer: Buffer, mimeType: string, originalName: string, fileType: 'avatar' | 'product' | 'document'): Promise<CloudStorageResult> {
        const fileName = this.generateFileName(originalName, fileType);
        const file = this.storage.bucket(this.bucketName).file(fileName);

        await file.save(fileBuffer, {
            metadata: {
                contentType: mimeType,
                cacheControl: 'public, max-age=31536000', // 1 year cache
            },
            public: true,
        });

        return {
            fileId: fileName,
            cdnUrl: this.getCdnUrl(fileName),
            directUrl: `https://storage.googleapis.com/${this.bucketName}/${fileName}`,
            fileName: originalName,
            mimeType,
            size: fileBuffer.length
        };
    }

    private generateFileName(originalName: string, fileType: string): string {
        const timestamp = Date.now();
        const extension = path.extname(originalName);
        const baseName = path.basename(originalName, extension);
        return `${fileType}/${timestamp}-${baseName}${extension}`;
    }
}
```

### **Step 2: Updated Model Interfaces**

#### **Enhanced IFileReference (Settings Model)**
```typescript
export interface IFileReference {
    fileId: string;         // Cloud Storage fileName OR old Drive fileId
    url?: string;           // CDN URL for new files, proxy URL for old files  
    cdnUrl?: string;        // Direct CDN URL (new files only)
    directUrl?: string;     // Direct storage URL (fallback)
    fileName?: string;      // Original filename
    mimeType?: string;      // File MIME type  
    size?: number;          // File size in bytes
    storageType?: 'drive' | 'gcs'; // Track storage type for migration
    migratedAt?: Date;      // Migration timestamp
}
```

#### **Enhanced IProductImage (Product Model)**
```typescript
export interface IProductImage {
    url: string;            // CDN URL (preferred) or proxy URL (legacy)
    cdnUrl?: string;        // Direct CDN URL
    fileId: string;         // Cloud Storage fileName OR Drive fileId
    storageType?: 'drive' | 'gcs'; // Track storage type
    migratedAt?: Date;      // Migration timestamp
}
```

#### **Enhanced User Model Fields**
```typescript
// Add to existing IUser interface:
avatarCdnUrl?: string;      // Direct CDN URL for avatar
avatarStorageType?: 'drive' | 'gcs'; // Track storage type
avatarMigratedAt?: Date;    // Migration timestamp
```

### **Step 3: Hybrid File Access Service**

```typescript
// settings-service/src/services/fileAccess.service.ts
export class FileAccessService {
    private cloudStorage = new CloudStorageService();
    private driveService = new GoogleDriveService();

    async getFileUrl(fileRef: IFileReference): Promise<string> {
        // If already migrated to Cloud Storage
        if (fileRef.storageType === 'gcs' && fileRef.cdnUrl) {
            return fileRef.cdnUrl;
        }

        // If still on Google Drive
        if (fileRef.storageType === 'drive' || this.isDriveFileId(fileRef.fileId)) {
            return `/api/settings/files/${fileRef.fileId}`; // Keep proxy for now
        }

        // Default: try to construct CDN URL
        return this.cloudStorage.getCdnUrl(fileRef.fileId);
    }

    private isDriveFileId(fileId: string): boolean {
        // Google Drive file IDs are typically 33 characters starting with '1'
        return fileId.length === 33 && fileId.startsWith('1');
    }

    async migrateFileFromDrive(fileRef: IFileReference): Promise<IFileReference> {
        if (fileRef.storageType === 'gcs') {
            return fileRef; // Already migrated
        }

        try {
            // Download from Drive
            const { stream, mimeType } = await this.driveService.getFileContent(fileRef.fileId);
            const buffer = await this.streamToBuffer(stream);

            // Upload to Cloud Storage
            const result = await this.cloudStorage.uploadFile(
                buffer, 
                mimeType || 'application/octet-stream',
                fileRef.fileName || 'migrated-file',
                'migrated'
            );

            // Return updated file reference
            return {
                ...fileRef,
                fileId: result.fileId,
                url: result.cdnUrl,
                cdnUrl: result.cdnUrl,
                directUrl: result.directUrl,
                storageType: 'gcs',
                migratedAt: new Date()
            };
        } catch (error) {
            log.error(`Failed to migrate file ${fileRef.fileId}:`, error);
            throw error;
        }
    }

    private async streamToBuffer(stream: any): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }
}
```

### **Step 4: Migration Script**

```typescript
// settings-service/src/scripts/migrate-files.ts
import { connectToDatabase } from '../database/connection';
import UserModel from '../../user-service/src/database/models/user.model';
import SettingsModel from '../database/models/settings.model';
import ProductModel from '../../product-service/src/database/models/product.model';
import { FileAccessService } from '../services/fileAccess.service';

class FileMigrationService {
    private fileAccess = new FileAccessService();
    private batchSize = 50;

    async migrateAllFiles() {
        await connectToDatabase();
        
        console.log('🚀 Starting file migration from Google Drive to Cloud Storage...');
        
        // Migrate in batches to avoid memory issues
        await this.migrateUserAvatars();
        await this.migrateSettingsFiles();
        await this.migrateProductImages();
        
        console.log('✅ Migration completed successfully!');
    }

    async migrateUserAvatars() {
        console.log('📸 Migrating user avatars...');
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            const users = await UserModel.find({ 
                avatarId: { $exists: true, $ne: null },
                avatarStorageType: { $ne: 'gcs' } // Only migrate non-GCS files
            })
            .limit(this.batchSize)
            .skip(skip);

            if (users.length === 0) {
                hasMore = false;
                continue;
            }

            for (const user of users) {
                try {
                    console.log(`Migrating avatar for user ${user._id}...`);
                    
                    const fileRef: IFileReference = {
                        fileId: user.avatarId!,
                        fileName: `avatar-${user._id}`,
                        storageType: 'drive'
                    };

                    const migratedRef = await this.fileAccess.migrateFileFromDrive(fileRef);
                    
                    // Update user record
                    await UserModel.updateOne(
                        { _id: user._id },
                        {
                            avatar: migratedRef.cdnUrl,
                            avatarId: migratedRef.fileId,
                            avatarCdnUrl: migratedRef.cdnUrl,
                            avatarStorageType: 'gcs',
                            avatarMigratedAt: new Date()
                        }
                    );

                    console.log(`✅ Migrated avatar for user ${user._id}`);
                } catch (error) {
                    console.error(`❌ Failed to migrate avatar for user ${user._id}:`, error);
                }
            }

            skip += this.batchSize;
        }
    }

    async migrateSettingsFiles() {
        console.log('⚙️ Migrating settings files...');
        
        const settings = await SettingsModel.findOne();
        if (!settings) return;

        const fileFields = ['companyLogo', 'termsAndConditionsPdf', 'presentationVideo', 'presentationPdf'];
        
        for (const field of fileFields) {
            const fileRef = settings[field as keyof typeof settings] as IFileReference;
            if (fileRef?.fileId && fileRef.storageType !== 'gcs') {
                try {
                    console.log(`Migrating ${field}...`);
                    const migratedRef = await this.fileAccess.migrateFileFromDrive(fileRef);
                    
                    await SettingsModel.updateOne(
                        { _id: settings._id },
                        { [field]: migratedRef }
                    );
                    
                    console.log(`✅ Migrated ${field}`);
                } catch (error) {
                    console.error(`❌ Failed to migrate ${field}:`, error);
                }
            }
        }
    }

    async migrateProductImages() {
        console.log('🖼️ Migrating product images...');
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            const products = await ProductModel.find({
                'images.storageType': { $ne: 'gcs' }
            })
            .limit(this.batchSize)
            .skip(skip);

            if (products.length === 0) {
                hasMore = false;
                continue;
            }

            for (const product of products) {
                try {
                    console.log(`Migrating images for product ${product._id}...`);
                    
                    const migratedImages = [];
                    for (const image of product.images) {
                        if (image.storageType === 'gcs') {
                            migratedImages.push(image);
                            continue;
                        }

                        const fileRef: IFileReference = {
                            fileId: image.fileId,
                            fileName: `product-${product._id}-image`,
                            storageType: 'drive'
                        };

                        const migratedRef = await this.fileAccess.migrateFileFromDrive(fileRef);
                        
                        migratedImages.push({
                            url: migratedRef.cdnUrl!,
                            cdnUrl: migratedRef.cdnUrl,
                            fileId: migratedRef.fileId,
                            storageType: 'gcs',
                            migratedAt: new Date()
                        });
                    }

                    await ProductModel.updateOne(
                        { _id: product._id },
                        { images: migratedImages }
                    );

                    console.log(`✅ Migrated images for product ${product._id}`);
                } catch (error) {
                    console.error(`❌ Failed to migrate images for product ${product._id}:`, error);
                }
            }

            skip += this.batchSize;
        }
    }
}

// Run migration
if (require.main === module) {
    const migration = new FileMigrationService();
    migration.migrateAllFiles().catch(console.error);
}

export default FileMigrationService;
```

### **Step 5: Updated File Upload Service**

```typescript
// settings-service/src/services/settings.service.ts
async uploadGenericFile(file: Express.Multer.File, folderName?: string): Promise<UploadedFileInfo> {
    log.info(`Uploading generic file: ${file.originalname} (Size: ${file.size})`);
    
    try {
        // Always use Cloud Storage for new uploads
        const cloudStorage = new CloudStorageService();
        const fileType = this.determineFileType(folderName);
        
        const result = await cloudStorage.uploadFile(
            file.buffer,
            file.mimetype,
            file.originalname,
            fileType
        );
        
        // Return with CDN URL as primary URL
        const fileInfo: UploadedFileInfo = {
            fileId: result.fileId,
            url: result.cdnUrl,        // CDN URL as primary
            cdnUrl: result.cdnUrl,     // Also provide as separate field
            directUrl: result.directUrl, // Fallback direct URL
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storageType: 'gcs'
        };
        
        return fileInfo;
    } catch (error: any) {
        log.error(`Failed to upload generic file: ${error.message}`);
        throw new Error('Failed to upload file to storage.');
    }
}

private determineFileType(folderName?: string): 'avatar' | 'product' | 'document' {
    if (folderName?.includes('profile') || folderName?.includes('avatar')) return 'avatar';
    if (folderName?.includes('product')) return 'product';
    return 'document';
}
```

## 🚀 **Execution Plan**

### **Day 1: Setup (4 hours)**
```bash
# 1. Enable Cloud Storage API
# 2. Install dependencies
npm install @google-cloud/storage

# 3. Set up CDN (optional but recommended)
# Configure Cloud CDN in Google Cloud Console

# 4. Update environment variables
GOOGLE_CLOUD_STORAGE_BUCKET=sbc-files
CDN_DOMAIN=https://cdn.sniperbusinesscenter.com
```

### **Day 1-2: Route New Uploads (2 hours)**
- ✅ Update upload services to use Cloud Storage
- ✅ Test new file uploads
- ✅ Verify CDN URLs work correctly

### **Day 2-3: Batch Migration (8 hours)**
```bash
# Run migration script
cd settings-service
npm run migrate:files

# Monitor progress and handle any failures
npm run migrate:verify
```

### **Day 4: Verification & Cleanup (2 hours)**
- ✅ Test all file access endpoints
- ✅ Verify application functionality  
- ✅ Performance testing
- ✅ Optional: Remove old proxy endpoints

## 📊 **Expected Benefits**

| Aspect | Before | After |
|--------|--------|-------|
| **Storage Limit** | 15GB (exceeded) | Unlimited |
| **Monthly Cost** | $0 (but failing) | ~$0.40 |
| **File Access Speed** | Proxy (slower) | CDN (faster) |
| **Reliability** | Upload failures | 99.9% uptime |
| **Scalability** | Limited | Unlimited |

## 🔄 **Rollback Plan**

If issues arise:
1. **Keep existing proxy endpoints** during migration
2. **Database rollback**: Revert to original URLs if needed  
3. **File availability**: Both Drive and Cloud Storage files accessible
4. **Gradual rollback**: Switch uploads back to Drive if needed

## ✅ **Success Metrics**

- [ ] All existing files accessible via new URLs
- [ ] New uploads working with CDN URLs  
- [ ] No broken images/documents in applications
- [ ] File upload/access performance improved
- [ ] Monthly storage costs under $1
- [ ] Zero data loss during migration

This plan ensures a smooth transition with minimal risk and maximum benefit! 🚀 