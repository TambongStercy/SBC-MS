# 🔧 File Access Strategy: Drive ↔ Cloud Storage Transition

## 🎯 **File ID Pattern Detection**

### **Google Drive File IDs:**
```
Pattern: 33 characters, starts with '1'
Example: "1ABC123DEF456GHI789JKL012MNO345PQR"
Length: 33
Access: /api/settings/files/:fileId (proxy)
```

### **Cloud Storage Filenames:**
```
Pattern: folder/timestamp-filename.ext
Example: "avatar/1753276789837-profile.jpg"
Length: Variable (usually 30-50+ chars)
Access: https://storage.googleapis.com/bucket/filename (direct)
```

## 🏗️ **Enhanced Models (Backward Compatible)**

### **1. User Model Updates**
```typescript
// user-service/src/database/models/user.model.ts
export interface IUser extends Document {
    // ... existing fields ...
    
    // Current fields (keep as-is for compatibility)
    avatar?: string;                    // URL for accessing the avatar
    avatarId?: string;                  // File identifier (Drive ID or Cloud Storage filename)
    
    // NEW fields for tracking storage type
    avatarStorageType?: 'drive' | 'gcs'; // Track which storage backend
    avatarMigratedAt?: Date;            // When migration occurred
}

// Add to UserSchema - OPTIONAL fields for existing records
const UserSchema = new Schema<IUser>({
    // ... existing fields ...
    avatarStorageType: { 
        type: String, 
        enum: ['drive', 'gcs'],
        // NO default - undefined means "legacy/unknown"
    },
    avatarMigratedAt: { type: Date }
});
```

### **2. Product Model Updates**
```typescript
// product-service/src/database/models/product.model.ts
export interface IProductImage {
    url: string;                        // Access URL
    fileId: string;                     // File identifier
    storageType?: 'drive' | 'gcs';      // NEW: Track storage backend
    migratedAt?: Date;                  // NEW: Migration timestamp
}

const ProductImageSchema = new Schema<IProductImage>({
    url: { type: String, required: true },
    fileId: { type: String, required: true },
    storageType: { 
        type: String, 
        enum: ['drive', 'gcs']
        // NO default - undefined means "legacy"
    },
    migratedAt: { type: Date }
}, { _id: false });
```

### **3. Settings Model (Already Good)**
```typescript
// settings-service/src/database/models/settings.model.ts - Already has storageType
export interface IFileReference {
    fileId: string;                     // File identifier
    url?: string;                       // Access URL
    fileName?: string;
    mimeType?: string;
    size?: number;
    storageType?: 'drive' | 'gcs';      // Already exists!
}
```

## 🔧 **Universal File Access Service**

```typescript
// settings-service/src/services/fileAccess.service.ts
export class FileAccessService {
    private cloudStorage = new CloudStorageService();

    /**
     * Universal file URL resolver - works with ANY file reference
     */
    async getFileUrl(fileId: string, storageType?: 'drive' | 'gcs'): Promise<string> {
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
     * Detect Google Drive file ID vs Cloud Storage filename
     */
    isDriveFileId(fileId: string): boolean {
        // Google Drive file IDs: exactly 33 characters, start with '1'
        return fileId.length === 33 && fileId.startsWith('1') && /^[a-zA-Z0-9_-]+$/.test(fileId);
    }

    /**
     * Generate Cloud Storage CDN URL
     */
    private getCloudStorageUrl(fileName: string): string {
        return `https://storage.googleapis.com/sbc-file-storage/${fileName}`;
    }

    /**
     * Generate Drive proxy URL (legacy)
     */
    private getDriveProxyUrl(fileId: string): string {
        return `/api/settings/files/${fileId}`;
    }

    /**
     * Get file URL from any model format
     */
    async resolveFileFromModel(modelData: any, fileField: string): Promise<string | null> {
        // Handle User Model
        if (fileField === 'avatar' && modelData.avatarId) {
            return this.getFileUrl(modelData.avatarId, modelData.avatarStorageType);
        }

        // Handle Settings Model  
        if (modelData[fileField] && modelData[fileField].fileId) {
            const fileRef = modelData[fileField];
            return this.getFileUrl(fileRef.fileId, fileRef.storageType);
        }

        // Handle Product Images
        if (fileField === 'images' && Array.isArray(modelData.images)) {
            const resolvedImages = [];
            for (const image of modelData.images) {
                const url = await this.getFileUrl(image.fileId, image.storageType);
                resolvedImages.push({ ...image, resolvedUrl: url });
            }
            return resolvedImages;
        }

        return null;
    }
}
```

## 📡 **Updated API Controllers**

### **Enhanced File Proxy (Backward Compatible)**
```typescript
// settings-service/src/api/controllers/fileController.ts
export class FileController {
    private fileAccess = new FileAccessService();

    /**
     * Universal file access - handles both Drive and Cloud Storage
     * Route: GET /api/settings/files/:fileId
     */
    async getFile(req: Request, res: Response): Promise<void> {
        try {
            const { fileId } = req.params;
            
            if (this.fileAccess.isDriveFileId(fileId)) {
                // Legacy Google Drive file - serve via existing proxy
                await this.serveDriveFile(fileId, res);
            } else {
                // Cloud Storage file - redirect to CDN
                const cdnUrl = `https://storage.googleapis.com/sbc-file-storage/${fileId}`;
                res.redirect(cdnUrl);
            }
        } catch (error: any) {
            log.error(`Error serving file ${req.params.fileId}:`, error);
            res.status(404).json({ error: 'File not found' });
        }
    }

    private async serveDriveFile(fileId: string, res: Response): Promise<void> {
        // Existing Google Drive proxy logic (unchanged)
        const fileStream = await googleDriveService.getFileStream(fileId);
        fileStream.pipe(res);
    }
}
```

## 🔄 **Migration Examples**

### **BEFORE Migration:**
```typescript
// Database records
const user = {
    _id: "...",
    name: "John Doe",
    avatar: "/api/settings/files/1ABC123DEF456...",
    avatarId: "1ABC123DEF456GHI789...",
    // No storageType field (undefined)
};

const product = {
    _id: "...",
    images: [{
        url: "/api/settings/files/1XYZ789ABC123...",
        fileId: "1XYZ789ABC123DEF456...",
        // No storageType field (undefined)
    }]
};

// File access
const avatarUrl = user.avatar; // "/api/settings/files/1ABC123..."
```

### **DURING Migration (Hybrid):**
```typescript
// Some users migrated, some not
const migratedUser = {
    _id: "...",
    name: "Jane Doe",
    avatar: "https://storage.googleapis.com/sbc-file-storage/avatar/1753276789837-profile.jpg",
    avatarId: "avatar/1753276789837-profile.jpg",
    avatarStorageType: "gcs",
    avatarMigratedAt: new Date()
};

const legacyUser = {
    _id: "...",
    name: "John Doe", 
    avatar: "/api/settings/files/1ABC123DEF456...",
    avatarId: "1ABC123DEF456GHI789...",
    // No storageType (still legacy)
};

// Universal file access
const fileAccess = new FileAccessService();
const migratedUrl = await fileAccess.getFileUrl(migratedUser.avatarId, migratedUser.avatarStorageType);
// Result: "https://storage.googleapis.com/sbc-file-storage/avatar/1753276789837-profile.jpg"

const legacyUrl = await fileAccess.getFileUrl(legacyUser.avatarId);
// Auto-detects as Drive ID
// Result: "/api/settings/files/1ABC123DEF456..."
```

### **AFTER Migration (All Modern):**
```typescript
// All users migrated
const modernUser = {
    _id: "...",
    name: "John Doe",
    avatar: "https://storage.googleapis.com/sbc-file-storage/avatar/1753276789837-profile.jpg",
    avatarId: "avatar/1753276789837-profile.jpg", 
    avatarStorageType: "gcs",
    avatarMigratedAt: new Date()
};

// Direct CDN access (no proxy needed)
const directUrl = modernUser.avatar;
// Result: "https://storage.googleapis.com/sbc-file-storage/avatar/1753276789837-profile.jpg"
```

## 🎯 **Migration Process**

### **Step 1: Model Updates (No Data Loss)**
```bash
# Add optional storageType fields to all models
# Existing records: storageType = undefined (treated as 'drive')
# New uploads: storageType = 'gcs'
```

### **Step 2: New Uploads to Cloud Storage**
```typescript
// All new uploads automatically go to Cloud Storage
const uploadResult = await cloudStorageService.uploadFile(...);

// Save with new format
await UserModel.updateOne(
    { _id: userId },
    {
        avatar: uploadResult.cdnUrl,
        avatarId: uploadResult.fileName,        // "avatar/1753276789837-profile.jpg"
        avatarStorageType: 'gcs'
    }
);
```

### **Step 3: Batch Migrate Existing Files**
```typescript
// Find all users with Drive file IDs
const usersToMigrate = await UserModel.find({
    avatarId: { $exists: true },
    avatarStorageType: { $ne: 'gcs' }  // Not already migrated
});

for (const user of usersToMigrate) {
    if (fileAccess.isDriveFileId(user.avatarId)) {
        // Download from Drive, upload to Cloud Storage
        const migratedFile = await migrateDriveFile(user.avatarId);
        
        // Update database with new Cloud Storage info
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
```

## 🧪 **Testing the Detection Logic**

```typescript
const fileAccess = new FileAccessService();

// Test Drive file ID detection
console.log(fileAccess.isDriveFileId("1ABC123DEF456GHI789JKL012MNO345PQR")); // true
console.log(fileAccess.isDriveFileId("avatar/1753276789837-profile.jpg"));    // false

// Test URL generation
await fileAccess.getFileUrl("1ABC123DEF456GHI789JKL012MNO345PQR");
// Result: "/api/settings/files/1ABC123DEF456GHI789JKL012MNO345PQR"

await fileAccess.getFileUrl("avatar/1753276789837-profile.jpg");
// Result: "https://storage.googleapis.com/sbc-file-storage/avatar/1753276789837-profile.jpg"
```

## ✅ **Benefits**

1. **Zero Breaking Changes**: Existing file IDs continue to work
2. **Auto-Detection**: No manual configuration needed
3. **Gradual Migration**: Migrate files in batches over time
4. **Rollback Safe**: Can revert to Drive if needed
5. **Performance**: New files get direct CDN access
6. **Future Proof**: Clean separation between storage backends

This approach ensures your existing `avatarId`, `fileId`, and `imageId` fields continue working exactly as before, while new files automatically get the benefits of Cloud Storage! 🚀 