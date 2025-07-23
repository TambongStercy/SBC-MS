# 🔄 File Access Migration Strategy

## 📋 **File ID Pattern Recognition**

### **Google Drive File IDs:**
- **Pattern**: 33 characters, starts with '1'
- **Example**: `1ABC123DEF456GHI789JKL012MNO345PQR`
- **Access**: Via proxy `/api/settings/files/:fileId`

### **Cloud Storage Filenames:**
- **Pattern**: `folder/timestamp-filename.ext`
- **Example**: `avatar/1753276789837-profile.jpg`
- **Access**: Direct CDN URL `https://storage.googleapis.com/bucket/filename`

## 🏗️ **Enhanced Model Schemas**

### **1. User Model Enhancement**
```typescript
// Add to existing IUser interface in user-service/src/database/models/user.model.ts
export interface IUser extends Document {
    // ... existing fields ...
    
    // Enhanced avatar fields
    avatar?: string;                    // CDN URL (new) or proxy URL (legacy)
    avatarId?: string;                  // Cloud Storage filename (new) or Drive fileId (legacy)
    avatarStorageType?: 'drive' | 'gcs'; // NEW: Track storage backend
    avatarMigratedAt?: Date;            // NEW: Migration timestamp
}

// Add to UserSchema
const UserSchema = new Schema<IUser>({
    // ... existing fields ...
    avatarStorageType: { 
        type: String, 
        enum: ['drive', 'gcs'], 
        default: 'drive' // Default for existing records
    },
    avatarMigratedAt: { type: Date }
});
```

### **2. Product Model Enhancement**
```typescript
// Enhanced IProductImage in product-service/src/database/models/product.model.ts
export interface IProductImage {
    url: string;                        // CDN URL (new) or proxy URL (legacy)
    fileId: string;                     // Cloud Storage filename (new) or Drive fileId (legacy)
    storageType?: 'drive' | 'gcs';      // NEW: Track storage backend
    migratedAt?: Date;                  // NEW: Migration timestamp
}

// Enhanced ProductImageSchema
const ProductImageSchema = new Schema<IProductImage>({
    url: { type: String, required: true },
    fileId: { type: String, required: true },
    storageType: { 
        type: String, 
        enum: ['drive', 'gcs'], 
        default: 'drive' // Default for existing records
    },
    migratedAt: { type: Date }
}, { _id: false });
```

### **3. Settings Model (Already Enhanced)**
```typescript
// Current IFileReference in settings-service/src/database/models/settings.model.ts
export interface IFileReference {
    fileId: string;                     // Cloud Storage filename (new) or Drive fileId (legacy)
    url?: string;                       // CDN URL (new) or proxy URL (legacy)
    fileName?: string;                  // Original filename
    mimeType?: string;                  // File MIME type
    size?: number;                      // File size in bytes
    storageType?: 'drive' | 'gcs';      // Track storage backend
}
```

## 🔧 **File Access Service Implementation**

### **Smart File URL Resolution**
```typescript
// settings-service/src/services/fileAccess.service.ts
export class FileAccessService {
    private cloudStorage = new CloudStorageService();

    /**
     * Universal file URL resolver - works with both Drive and Cloud Storage files
     */
    async resolveFileUrl(fileId: string, storageType?: 'drive' | 'gcs'): Promise<string> {
        // Method 1: Use explicit storage type if provided
        if (storageType === 'gcs') {
            return this.getCloudStorageUrl(fileId);
        }
        if (storageType === 'drive') {
            return this.getDriveProxyUrl(fileId);
        }

        // Method 2: Auto-detect based on fileId pattern
        if (this.isDriveFileId(fileId)) {
            return this.getDriveProxyUrl(fileId);
        } else {
            return this.getCloudStorageUrl(fileId);
        }
    }

    /**
     * Detect Google Drive file ID pattern
     */
    private isDriveFileId(fileId: string): boolean {
        // Google Drive file IDs: 33 characters, start with '1'
        return fileId.length === 33 && fileId.startsWith('1');
    }

    /**
     * Generate Cloud Storage CDN URL
     */
    private getCloudStorageUrl(fileName: string): string {
        return `https://storage.googleapis.com/sbc-file-storage/${fileName}`;
    }

    /**
     * Generate Drive proxy URL
     */
    private getDriveProxyUrl(fileId: string): string {
        return `/api/settings/files/${fileId}`;
    }

    /**
     * Enhanced file info resolver for all models
     */
    async getFileInfo(fileRef: any): Promise<{ url: string; isLegacy: boolean }> {
        let url: string;
        let isLegacy: boolean;

        // Handle different model formats
        if (fileRef.storageType) {
            // Settings Model format (IFileReference)
            url = await this.resolveFileUrl(fileRef.fileId, fileRef.storageType);
            isLegacy = fileRef.storageType === 'drive';
        } else if (fileRef.avatarId && fileRef.avatarStorageType) {
            // User Model format
            url = await this.resolveFileUrl(fileRef.avatarId, fileRef.avatarStorageType);
            isLegacy = fileRef.avatarStorageType === 'drive';
        } else if (fileRef.fileId) {
            // Product Model or legacy format
            const storageType = fileRef.storageType || (this.isDriveFileId(fileRef.fileId) ? 'drive' : 'gcs');
            url = await this.resolveFileUrl(fileRef.fileId, storageType);
            isLegacy = storageType === 'drive';
        } else {
            throw new Error('Invalid file reference format');
        }

        return { url, isLegacy };
    }
}
```

## 📡 **Updated API Endpoints**

### **Enhanced File Proxy Endpoint**
```typescript
// settings-service/src/api/controllers/fileController.ts
export class FileController {
    private fileAccess = new FileAccessService();

    /**
     * Universal file access endpoint - handles both Drive and Cloud Storage
     */
    async getFile(req: Request, res: Response): Promise<void> {
        try {
            const { fileId } = req.params;
            
            // Auto-detect storage type and redirect accordingly
            if (this.fileAccess.isDriveFileId(fileId)) {
                // Legacy Google Drive file - serve via proxy
                await this.serveDriveFile(fileId, res);
            } else {
                // Cloud Storage file - redirect to CDN
                const cdnUrl = this.fileAccess.getCloudStorageUrl(fileId);
                res.redirect(cdnUrl);
            }
        } catch (error: any) {
            res.status(404).json({ error: 'File not found' });
        }
    }

    private async serveDriveFile(fileId: string, res: Response): Promise<void> {
        // Existing Google Drive proxy logic
        const stream = await googleDriveService.getFileStream(fileId);
        stream.pipe(res);
    }
}
```

## 🔄 **Migration Process**

### **Phase 1: Model Updates (No Data Migration)**
```bash
# Update models to support storageType field
# Existing records will have storageType: undefined (treated as 'drive')
# New uploads will have storageType: 'gcs'
```

### **Phase 2: Hybrid Upload System**
```typescript
// settings-service/src/services/upload.service.ts
async uploadFile(file: Express.Multer.File): Promise<FileReference> {
    // Always upload new files to Cloud Storage
    const result = await cloudStorageService.uploadFile(file.buffer, file.mimetype, file.originalname);
    
    return {
        fileId: result.fileName,           // Cloud Storage filename
        url: result.cdnUrl,                // Direct CDN URL
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageType: 'gcs'                 // Mark as Cloud Storage
    };
}
```

### **Phase 3: Batch Migration Script**
```typescript
// Migrate existing files and update database records
async migrateExistingFiles(): Promise<void> {
    // 1. Find all records with Drive file IDs
    const users = await UserModel.find({ 
        avatarId: { $exists: true },
        avatarStorageType: { $ne: 'gcs' }  // Not already migrated
    });

    // 2. Migrate each file
    for (const user of users) {
        if (this.isDriveFileId(user.avatarId)) {
            const migratedFile = await this.migrateFile(user.avatarId);
            
            // 3. Update database record
            await UserModel.updateOne(
                { _id: user._id },
                {
                    avatar: migratedFile.cdnUrl,
                    avatarId: migratedFile.fileName,
                    avatarStorageType: 'gcs',
                    avatarMigratedAt: new Date()
                }
            );
        }
    }
}
```

## 🎯 **File Access Examples**

### **Before Migration (Legacy):**
```typescript
// User avatar access
const user = await UserModel.findById(userId);
const avatarUrl = `/api/settings/files/${user.avatarId}`; // Proxy URL
// Result: "/api/settings/files/1ABC123..."
```

### **After Migration (Modern):**
```typescript
// User avatar access
const user = await UserModel.findById(userId);
const fileAccess = new FileAccessService();
const avatarUrl = await fileAccess.resolveFileUrl(user.avatarId, user.avatarStorageType);
// Result: "https://storage.googleapis.com/sbc-file-storage/avatar/1234567890-profile.jpg"
```

### **Hybrid Support (During Transition):**
```typescript
// Works for both old and new files
const fileAccess = new FileAccessService();

// Old Drive file
const oldUrl = await fileAccess.resolveFileUrl("1ABC123DEF456...", "drive");
// Result: "/api/settings/files/1ABC123DEF456..."

// New Cloud Storage file  
const newUrl = await fileAccess.resolveFileUrl("avatar/1234567890-profile.jpg", "gcs");
// Result: "https://storage.googleapis.com/sbc-file-storage/avatar/1234567890-profile.jpg"

// Auto-detect (no storageType specified)
const autoUrl = await fileAccess.resolveFileUrl("1ABC123DEF456..."); // Detects as Drive
const autoUrl2 = await fileAccess.resolveFileUrl("avatar/1234567890-profile.jpg"); // Detects as Cloud Storage
```

## ✅ **Benefits of This Approach**

1. **Backward Compatibility**: Existing file IDs continue to work
2. **Auto-Detection**: No manual intervention needed for file access
3. **Gradual Migration**: Can migrate files in batches over time
4. **Zero Downtime**: Applications continue working during migration
5. **Rollback Safe**: Can revert to Drive if needed
6. **Performance**: New files get direct CDN access immediately

## 🚨 **Important Notes**

1. **Proxy Endpoint**: Keep `/api/settings/files/:fileId` working for legacy Drive files
2. **Database Migration**: Add `storageType` fields but don't require them (default to 'drive')
3. **CDN URLs**: New files get direct CDN URLs, no proxy needed
4. **File Detection**: Auto-detection based on file ID pattern works reliably
5. **Migration Tracking**: Track migration status per file for debugging

This strategy ensures seamless transition with zero downtime! 🚀 