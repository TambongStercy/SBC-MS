# Google Drive Storage Upgrade Guide

🛡️ **SAFETY FIRST**: This solution NEVER deletes user content (profile pictures, product images). Only safe temporary files are considered for cleanup.

## Current Situation
- **Service Account**: `sniperdriveservice@snipper-c0411.iam.gserviceaccount.com`
- **Current Usage**: 14.99GB / 15GB (99.9% full)
- **Issue**: Service accounts have 15GB free storage limit, after which uploads fail
- **User Content**: PROTECTED from any automated cleanup

## Upgrade Options

### Option 1: Enable Billing on Google Cloud Project ⭐ RECOMMENDED

**Cost**: ~$0.02 USD per GB per month (very affordable)
**Setup Time**: 15 minutes

#### Steps:
1. **Go to Google Cloud Console**: https://console.cloud.google.com
2. **Select your project**: `snipper-c0411` (or whatever project contains your service account)
3. **Enable billing**:
   - Go to "Billing" in the left menu
   - Link a credit card/bank account
   - Enable "Google Drive API" billing
4. **Verify**: Storage will become unlimited with pay-per-use

#### Monthly Cost Estimate:
- **Current usage (15GB)**: $0.30/month
- **50GB**: $1.00/month  
- **100GB**: $2.00/month

### Option 2: Migrate to Google Cloud Storage

**Cost**: ~$0.020/GB/month (same as Drive API)
**Benefits**: Better for programmatic access, versioning, CDN integration

#### Implementation:
```typescript
// New storage service using Google Cloud Storage
import { Storage } from '@google-cloud/storage';

class CloudStorageService {
    private storage: Storage;
    private bucketName = 'sbc-file-storage';
    
    constructor() {
        this.storage = new Storage({
            projectId: 'snipper-c0411',
            keyFilename: 'path/to/service-account-key.json'
        });
    }
    
    async uploadFile(buffer: Buffer, fileName: string): Promise<string> {
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(fileName);
        
        await file.save(buffer, {
            metadata: { contentType: 'auto' },
            public: true
        });
        
        return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
    }
}
```

### Option 3: Hybrid Solution (Current Files + New Storage)

Keep existing files on Drive, route new uploads to Cloud Storage:

```typescript
class HybridStorageService {
    private driveService: GoogleDriveService;
    private cloudStorage: CloudStorageService;
    private useDriveForSmallFiles = true;
    private driveSizeLimit = 10 * 1024 * 1024; // 10MB
    
    async uploadFile(buffer: Buffer, fileName: string, mimeType: string): Promise<UploadResult> {
        if (buffer.length <= this.driveSizeLimit && this.useDriveForSmallFiles) {
            try {
                return await this.driveService.uploadFile(buffer, mimeType, fileName);
            } catch (error) {
                // Fallback to cloud storage if drive fails
                log.warn('Drive upload failed, falling back to cloud storage');
                return await this.cloudStorage.uploadFile(buffer, fileName);
            }
        }
        
        return await this.cloudStorage.uploadFile(buffer, fileName);
    }
}
```

### Option 4: Safe Storage Management (USER CONTENT PROTECTED)

🛡️ **CRITICAL**: User profile pictures and product images are NEVER deleted or archived.

Implement intelligent monitoring and safe optimization:

```typescript
class SafeStorageService {
    async manageStorage(): Promise<void> {
        const usage = await this.getStorageUsage();
        
        if (usage.percentage > 85) {
            // Recommend billing upgrade (PRIMARY solution)
            await this.recommendBillingUpgrade();
        }
        
        if (usage.percentage > 95) {
            // Clean ONLY safe temporary files
            await this.cleanupSafeTempFiles();
        }
        
        if (usage.percentage > 98) {
            // Emergency: Send alerts for immediate billing upgrade
            await this.sendEmergencyUpgradeAlert();
        }
    }
    
    async cleanupSafeTempFiles(): Promise<void> {
        // ONLY files with safe prefixes: temp_, cache_, log_, etc.
        // EXCLUDES: Profile pictures, product images, user content
        const safeFiles = await this.findSafeTempFiles();
        
        for (const file of safeFiles) {
            // Only delete if confirmed safe (temp/cache files)
            if (this.isSafeToDelete(file)) {
                await this.deleteFile(file);
            }
        }
    }
    
    private isSafeToDelete(file: any): boolean {
        const safePrefixes = ['temp_', 'cache_', 'log_', 'backup_'];
        const protectedFolders = [config.PP_FOLDER, config.PD_FOLDER];
        
        // Never delete files in protected folders
        if (file.parents?.some(parent => protectedFolders.includes(parent))) {
            return false;
        }
        
        // Only delete files with safe prefixes
        return safePrefixes.some(prefix => file.name.startsWith(prefix));
    }
}
```

## Implementation Timeline

### Phase 1: Immediate (Today)
1. Enable billing on Google Cloud project
2. Test upload functionality
3. Monitor usage

### Phase 2: Short-term (This week)
1. Implement automated cleanup system
2. Add storage monitoring alerts
3. Set up usage dashboards

### Phase 3: Long-term (Next month)
1. Migrate to Cloud Storage for new files
2. Implement file compression
3. Add CDN for faster file access

## Monitoring Setup

Add storage monitoring to prevent future issues:

```typescript
class StorageMonitor {
    async checkStorageHealth(): Promise<void> {
        const usage = await this.getStorageUsage();
        
        if (usage.percentage > 80) {
            await this.sendAlert('Storage at 80%', usage);
        }
        
        if (usage.percentage > 90) {
            await this.triggerCleanup();
        }
        
        if (usage.percentage > 95) {
            await this.sendUrgentAlert('Storage critical', usage);
        }
    }
}
```

## Cost Comparison

| Solution | Setup Cost | Monthly Cost (50GB) | Pros | Cons |
|----------|------------|-------------------|------|------|
| Enable GCP Billing | Free | $1.00 | Easy, immediate | Still tied to Drive limits |
| Cloud Storage | $0 | $1.00 | Scalable, fast | Requires code changes |
| Hybrid | $0 | $0.50-1.00 | Best of both | More complex |
| Google One | N/A | N/A | ❌ Doesn't work with service accounts | ❌ |

## Recommendation

**Start with Option 1 (Enable GCP Billing)** for immediate relief, then implement Option 4 (Automated Management) for long-term sustainability.

This gives you:
- ✅ Immediate storage relief
- ✅ Very low cost ($1-2/month)
- ✅ Minimal code changes
- ✅ Future-proof scaling 