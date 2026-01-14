#!/bin/bash

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/mongo-backup-${TIMESTAMP}"
GCS_BUCKET="${GCS_BUCKET_NAME}"
GCP_AUTH_SUCCESS=false

echo "[$(date)] ============================================"
echo "[$(date)] Starting MongoDB backup..."
echo "[$(date)] ============================================"

# Authenticate with GCP if credentials exist
if [ -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]; then
    echo "[$(date)] Authenticating with Google Cloud..."
    if gcloud auth activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" 2>/dev/null; then
        echo "[$(date)] ✓ GCP authentication successful"
        GCP_AUTH_SUCCESS=true
    else
        echo "[$(date)] ✗ GCP authentication failed - will save backup locally"
    fi
else
    echo "[$(date)] WARNING: No GCP credentials found at ${GOOGLE_APPLICATION_CREDENTIALS}"
    echo "[$(date)] Backup will be created locally only"
fi

# Create backup directory
mkdir -p ${BACKUP_DIR}

# Define databases to backup
DATABASES="sbc_user_dev sbc_payment_dev sbc_product_dev sbc_notification_dev sbc_tombola_dev sbc_settings_dev sbc_chat_dev sbc_advertising_dev"

# Backup each database
for DB in ${DATABASES}; do
    echo "[$(date)] Backing up ${DB}..."
    if mongodump --uri="${MONGODB_URI}/${DB}" --out="${BACKUP_DIR}" --gzip 2>/dev/null; then
        echo "[$(date)] ✓ ${DB} backed up successfully"
    else
        echo "[$(date)] ✗ ${DB} backup failed or database doesn't exist, skipping..."
    fi
done

# Create tarball
BACKUP_FILE="/tmp/sbc-backup-${TIMESTAMP}.tar.gz"
echo "[$(date)] Creating compressed archive..."
tar -czvf ${BACKUP_FILE} -C ${BACKUP_DIR} .

BACKUP_SIZE=$(du -h ${BACKUP_FILE} | cut -f1)
echo "[$(date)] Backup file created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Upload to GCS if bucket is configured and auth succeeded
if [ -n "${GCS_BUCKET}" ] && [ "${GCP_AUTH_SUCCESS}" = true ]; then
    echo "[$(date)] Uploading to Google Cloud Storage bucket: ${GCS_BUCKET}..."

    if gsutil cp ${BACKUP_FILE} gs://${GCS_BUCKET}/mongodb-backups/; then
        echo "[$(date)] ✓ Upload successful!"

        # Cleanup old backups (keep last 30)
        echo "[$(date)] Cleaning up old backups (keeping last 30)..."
        gsutil ls -l gs://${GCS_BUCKET}/mongodb-backups/ | sort -k2 | head -n -30 | awk '{print $3}' | xargs -r gsutil rm 2>/dev/null || true
    else
        echo "[$(date)] ✗ Upload failed!"
        # Save locally as fallback
        mkdir -p /backups
        cp ${BACKUP_FILE} /backups/
        echo "[$(date)] Backup also saved locally to /backups/"
    fi
else
    echo "[$(date)] Skipping GCS upload (bucket not configured or auth failed)"
    # Keep local backup for manual retrieval
    mkdir -p /backups
    mv ${BACKUP_FILE} /backups/
    echo "[$(date)] Backup saved locally to /backups/"
fi

# Cleanup local temp files
rm -rf ${BACKUP_DIR}
[ -f ${BACKUP_FILE} ] && rm ${BACKUP_FILE}

echo "[$(date)] ============================================"
echo "[$(date)] Backup completed!"
echo "[$(date)] ============================================"
