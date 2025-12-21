# Google Cloud Storage Setup for Status Media

This guide will help you set up a **private** Google Cloud Storage bucket for storing status/story media files.

## Prerequisites

1. Google Cloud Platform account
2. Project created in GCP Console
3. Billing enabled on your project

## Step 1: Create a Private GCS Bucket

### Via GCP Console (Web UI)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **Cloud Storage** > **Buckets**
3. Click **CREATE BUCKET**

4. **Name your bucket**:
   - Bucket name: `sbc-status-media-private` (must be globally unique)
   - If name is taken, try: `sbc-status-media-private-{your-project-id}`

5. **Choose where to store your data**:
   - Location type: `Region` (for lower latency) or `Multi-region` (for high availability)
   - Location: Choose closest to your users (e.g., `us-central1`, `europe-west1`, `asia-southeast1`)

6. **Choose a storage class**:
   - Standard (for frequently accessed data - recommended for status media)

7. **Choose how to control access to objects**:
   - ✅ **Uncheck** "Enforce public access prevention on this bucket"
   - Access control: **Fine-grained** (object-level permissions)
   - ⚠️ **IMPORTANT**: DO NOT make the bucket public

8. **Choose how to protect object data**:
   - Protection tools: None needed (or enable versioning if you want)
   - Click **CREATE**

### Via gcloud CLI

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Create private bucket
gsutil mb -c STANDARD -l US-CENTRAL1 gs://sbc-status-media-private

# Verify bucket is private (should show NO public access)
gsutil iam get gs://sbc-status-media-private
```

## Step 2: Set Bucket Permissions

The bucket should be **PRIVATE** by default. Verify:

```bash
# Check bucket IAM policy
gsutil iam get gs://sbc-status-media-private

# Should NOT contain "allUsers" or "allAuthenticatedUsers"
```

## Step 3: Create Service Account

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **CREATE SERVICE ACCOUNT**

3. **Service account details**:
   - Name: `sbc-status-storage`
   - Description: `Service account for SBC status media storage`
   - Click **CREATE AND CONTINUE**

4. **Grant permissions**:
   - Role: `Storage Object Admin` (for full read/write/delete access)
   - Click **CONTINUE**

5. **Grant users access** (optional):
   - Skip this step
   - Click **DONE**

## Step 4: Create and Download Service Account Key

1. Click on the service account you just created
2. Go to **KEYS** tab
3. Click **ADD KEY** > **Create new key**
4. Choose **JSON** format
5. Click **CREATE**
6. The key file will download automatically (e.g., `your-project-abc123.json`)

⚠️ **IMPORTANT**: This key file grants access to your GCS bucket. Keep it secure!

## Step 5: Configure Your Application

### 1. Move the key file to your project:

```bash
# Place the downloaded JSON key in chat-service root
mv ~/Downloads/your-project-abc123.json ./chat-service/gcs-key.json
```

### 2. Add to `.gitignore`:

```bash
# In chat-service/.gitignore
gcs-key.json
*.json  # If not already there
```

### 3. Update `.env` file:

```env
# Google Cloud Storage Configuration
GCS_PROJECT_ID=your-project-id
GCS_KEY_FILENAME=./gcs-key.json
GCS_STATUS_BUCKET=sbc-status-media-private
GCS_SIGNED_URL_EXPIRY=3600  # 1 hour in seconds
```

### 4. For Docker deployments:

**docker-compose.yml**:
```yaml
chat-service:
  volumes:
    - ./chat-service/gcs-key.json:/app/gcs-key.json:ro
  environment:
    - GCS_KEY_FILENAME=/app/gcs-key.json
```

**Dockerfile** (if needed):
```dockerfile
# Copy GCS credentials
COPY gcs-key.json /app/gcs-key.json
```

## Step 6: Install Required Dependencies

```bash
cd chat-service
npm install @google-cloud/storage uuid
npm install --save-dev @types/uuid
```

## Step 7: Test the Setup

Create a test script:

```typescript
// chat-service/test-gcs.ts
import { gcsStorage } from './src/utils/gcs-storage';

async function testGCS() {
    try {
        // Test bucket access
        const testFile = {
            buffer: Buffer.from('Hello, GCS!'),
            originalname: 'test.txt',
            mimetype: 'text/plain'
        } as Express.Multer.File;

        console.log('Uploading test file...');
        const result = await gcsStorage.uploadFile(testFile, 'test');
        console.log('Upload successful:', result);

        console.log('Generating signed URL...');
        const filePath = gcsStorage.extractFilePath(result.publicUrl);
        const signedUrl = await gcsStorage.getSignedUrl(filePath);
        console.log('Signed URL:', signedUrl);

        console.log('Deleting test file...');
        await gcsStorage.deleteFile(filePath);
        console.log('Test complete!');
    } catch (error) {
        console.error('GCS test failed:', error);
    }
}

testGCS();
```

Run the test:
```bash
npx ts-node test-gcs.ts
```

## Step 8: Security Best Practices

### ✅ DO:
- Keep bucket **private** (no public access)
- Use **signed URLs** with short expiry (1-24 hours)
- Store service account key securely (never commit to git)
- Use environment variables for configuration
- Rotate service account keys periodically
- Monitor bucket access logs

### ❌ DON'T:
- Make the bucket public
- Commit service account keys to version control
- Use long-lived signed URLs (> 24 hours)
- Give excessive permissions (use least privilege)
- Share service account keys

## Step 9: CORS Configuration (if needed for direct uploads)

If you need to allow direct uploads from browser:

```bash
# Create cors.json
echo '[
  {
    "origin": ["https://yourdomain.com"],
    "method": ["GET", "POST", "PUT"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]' > cors.json

# Apply CORS configuration
gsutil cors set cors.json gs://sbc-status-media-private
```

## Monitoring & Costs

### View Storage Usage:
```bash
gsutil du -sh gs://sbc-status-media-private
```

### Estimated Costs (as of 2024):
- Storage: ~$0.020 per GB/month (Standard, US)
- Network egress: ~$0.12 per GB (to internet)
- Class A operations (writes): $0.05 per 10,000 operations
- Class B operations (reads): $0.004 per 10,000 operations

**Example**:
- 1000 users posting 2 status/day with 2MB media = 4GB/day = 120GB/month
- Storage cost: 120GB × $0.02 = $2.40/month
- + Operations and egress

### Set Budget Alerts:
1. Go to **Billing** > **Budgets & alerts**
2. Create a budget alert to notify you when costs exceed threshold

## Troubleshooting

### Error: "Could not load the default credentials"
- Verify `GCS_KEY_FILENAME` path is correct
- Check JSON key file exists and is valid
- Ensure `GCS_PROJECT_ID` matches the key file

### Error: "Access Denied"
- Verify service account has `Storage Object Admin` role
- Check bucket name in config matches actual bucket
- Ensure bucket is in the same project as service account

### Error: "Bucket not found"
- Verify bucket name is correct (check for typos)
- Ensure bucket was created successfully
- Check you're using the correct GCP project

## Next Steps

After setup:
1. Test file uploads from your application
2. Verify signed URLs are working
3. Monitor storage usage and costs
4. Set up lifecycle policies to auto-delete old status media (optional)

### Lifecycle Policy (Auto-delete after 30 days):

```json
// lifecycle.json
{
  "lifecycle": {
    "rule": [{
      "action": {"type": "Delete"},
      "condition": {
        "age": 30,
        "matchesPrefix": ["statuses/"]
      }
    }]
  }
}
```

Apply:
```bash
gsutil lifecycle set lifecycle.json gs://sbc-status-media-private
```

This ensures old status media doesn't accumulate and waste storage.
