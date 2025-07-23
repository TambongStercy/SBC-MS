# 🚀 Google Cloud Storage Setup Guide

## 📋 Required Environment Variables

Create a `.env` file in the `settings-service/` directory with these variables:

```bash
# Google Drive/Cloud Storage Credentials
# (Same service account works for both Google Drive and Google Cloud Storage)
DRIVE_CLIENT_EMAIL=your-service-account@snipper-c0411.iam.gserviceaccount.com
DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour\nPrivate\nKey\nHere\n-----END PRIVATE KEY-----\n"

# Basic Service Configuration
NODE_ENV=development
PORT=3007

# Database Configuration (adjust as needed)
MONGODB_URI_DEV=mongodb://localhost:27017/sbc_settings_dev
MONGODB_URI_PROD=mongodb://your-production-mongo-uri

# JWT Configuration
JWT_SECRET=your-jwt-secret-key
ACCESS_TOKEN_EXPIRY=1h
REFRESH_TOKEN_EXPIRY=7d
```

## 🔑 Getting Your Service Account Credentials

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/iam-admin/serviceaccounts?project=snipper-c0411

2. **Find your service account** (the one you're already using for Google Drive)

3. **Create/Download Key:**
   - Click on your service account
   - Go to "Keys" tab
   - Click "Add Key" → "Create new key" 
   - Choose "JSON" format
   - Download the file

4. **Extract credentials from JSON:**
   ```json
   {
     "client_email": "your-service-account@snipper-c0411.iam.gserviceaccount.com",
     "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   }
   ```

## ⚡ Quick Test Commands

After creating your `.env` file:

```bash
# 1. Test Google Cloud Storage setup
node enable-cloud-storage.js

# 2. Run comprehensive storage tests
node test-storage-migration.js

# 3. If tests pass, run migration (dry run first)
node migrate-drive-to-gcs.js
```

## 🎯 Expected Test Results

✅ **Success:** Cloud Storage API working, bucket created  
✅ **Success:** File upload/download test passes  
✅ **Ready:** Migration can proceed  

## ❗ Common Issues

- **API not enabled:** Follow the link provided in error message
- **Billing not linked:** Ensure billing account is connected to project `snipper-c0411`
- **Wrong credentials:** Double-check service account email and private key format

---

**Next Step:** Create your `.env` file and run `node enable-cloud-storage.js` 