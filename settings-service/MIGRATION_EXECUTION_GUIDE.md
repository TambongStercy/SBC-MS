# 🚀 Storage Migration Execution Guide

## ✅ **Current Status**

### **What's Already Implemented:**
- ✅ **Migration script**: Transfers files from Drive to Cloud Storage
- ✅ **Settings service updated**: New uploads go to Cloud Storage automatically  
- ✅ **Database models enhanced**: Support both Drive and Cloud Storage references
- ✅ **CDN-ready URLs**: Direct access without proxy endpoints
- ✅ **Hybrid system**: Backward compatible with existing Drive files

### **What Storage Issue is Fixed:**
- ❌ **Google Drive**: 15GB hard limit (99.9% full)
- ✅ **Cloud Storage**: Unlimited (~$0.40/month for current usage)

## 🎯 **Step-by-Step Execution**

### **Step 1: Enable Cloud Storage API (5 minutes)**

```bash
cd settings-service

# Check current setup
node enable-cloud-storage.js
```

**If API is not enabled, you'll get a direct link:**
1. Go to: https://console.cloud.google.com/apis/library/storage-component.googleapis.com?project=snipper-c0411
2. Click **"ENABLE"** button
3. Wait 1-2 minutes for activation
4. Re-run the script to verify

### **Step 2: Test Cloud Storage Setup (3 minutes)**

```bash
# Run pre-flight tests
node test-storage-migration.js
```

**Expected output:**
```
🧪 Testing Cloud Storage Upload/Download...
✅ Upload successful!
✅ File is publicly accessible via CDN URL
🎉 Cloud Storage test completed successfully!
```

### **Step 3: Dry Run Migration (10 minutes)**

```bash
# Test migration without moving files
node migrate-drive-to-gcs.js
```

**This will:**
- ✅ List all files in your Google Drive
- ✅ Simulate the migration process
- ✅ Create `migration-backup.json` with the plan
- ✅ Show exactly what will happen

**Review the results:**
```bash
# Check migration plan
cat migration-backup.json
```

### **Step 4: Actual Migration (20-30 minutes)**

**Edit the migration script:**
```javascript
// In migrate-drive-to-gcs.js, line 26:
dryRun: false, // Change from true to false
```

**Run the migration:**
```bash
node migrate-drive-to-gcs.js
```

**Expected progress:**
```
🚀 Starting migration (Dry Run: false)...
📁 Fetching all files from Google Drive...
✅ Total files found: 150

📦 Processing batch 1 (10 files)...
  🔄 Migrating: logo_1234567890_company-logo.png
     ⬇️  Downloaded: logo_1234567890_company-logo.png (45678 bytes)
     ⬆️  Uploaded to: https://storage.googleapis.com/sbc-file-storage/logo_1234567890_company-logo.png

🗃️  Updating database references...
✅ Database updates completed: 89 records updated

✅ Migration completed!
   📊 Successful: 148
   ❌ Failed: 2
   📝 Total: 150
```

### **Step 5: Verify Migration (5 minutes)**

```bash
# Test file access after migration
curl -I "https://storage.googleapis.com/sbc-file-storage/logo_1234567890_company-logo.png"

# Should return: HTTP/1.1 200 OK
```

### **Step 6: Restart Services (2 minutes)**

```bash
# Restart settings service to use new storage
npm restart

# Or if using PM2:
pm2 restart settings-service
```

## 📊 **What Changes in Your System**

### **Before Migration:**
```typescript
// User Model
avatar: "/api/settings/files/1ABC..." // Proxy URL
avatarId: "1ABC..." // Google Drive ID

// Settings Model  
companyLogo: {
  fileId: "1ABC...", // Drive ID
  fileName: "logo.png"
}
```

### **After Migration:**
```typescript
// User Model
avatar: "https://storage.googleapis.com/sbc-file-storage/logo.png" // Direct CDN URL
avatarId: "1ABC..." // Kept for compatibility

// Settings Model
companyLogo: {
  fileId: "logo_1234567890_company-logo.png", // Cloud Storage filename
  url: "https://storage.googleapis.com/sbc-file-storage/logo_1234567890_company-logo.png", // CDN URL
  fileName: "logo.png",
  storageType: "gcs" // Marked as Cloud Storage
}
```

## 🔧 **Troubleshooting**

### **Issue: "Cloud Storage API has not been used"**
**Solution:**
```bash
# Go directly to enable API
open "https://console.cloud.google.com/apis/library/storage-component.googleapis.com?project=snipper-c0411"
```

### **Issue: "The user's Drive storage quota has been exceeded"**
**This is expected!** This error confirms why we're migrating.

### **Issue: Migration script fails on some files**
**Normal behavior:**
- The script processes files in batches
- Failed files are logged but don't stop the migration
- Check `migration-backup.json` for details

### **Issue: Some files still show proxy URLs**
**Hybrid system working:**
- Old files: Continue using `/api/settings/files/:fileId` (works)
- New files: Use direct CDN URLs (faster)
- During migration: URLs are updated automatically

## 🎉 **Expected Benefits After Migration**

### **Immediate:**
- ✅ **No more storage quota errors**
- ✅ **Faster file loading** (direct CDN vs proxy)
- ✅ **Unlimited storage capacity**

### **Long-term:**
- ✅ **Better performance** (~50% faster file serving)
- ✅ **Lower costs** (~$0.40/month vs Drive limits)
- ✅ **Scalable architecture** (handles growth automatically)

## 📞 **Need Help?**

**Common commands for monitoring:**
```bash
# Check storage service logs
tail -f logs/settings-service.log

# Test a specific file URL
curl -I "https://storage.googleapis.com/sbc-file-storage/YOUR_FILE.png"

# Check migration backup
cat migration-backup.json | jq '.migrationLog[] | select(.success == false)'
```

**If you encounter issues:**
1. **Check the migration backup file** for detailed logs
2. **Run the test script** to verify setup: `node test-storage-migration.js`
3. **Restart the settings service** if file URLs aren't working

---

🚀 **Ready to begin? Start with Step 1: `node enable-cloud-storage.js`** 