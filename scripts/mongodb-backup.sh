#!/bin/bash

# MongoDB Automated Backup Script with Google Drive Upload
# Place this in /opt/mongodb-backup/scripts/mongodb-backup.sh

# Configuration
MONGODB_URI="mongodb://localhost:27017"
BACKUP_DIR="/opt/mongodb-backup/temp"
LOG_FILE="/var/log/mongodb-backup/backup.log"
GDRIVE_REMOTE="gdrive"  # Name of your rclone Google Drive remote
GDRIVE_FOLDER="mongodb-backups"  # Folder in Google Drive
RETENTION_DAYS=30  # Keep backups for 30 days locally
GDRIVE_RETENTION_DAYS=90  # Keep backups for 90 days in Google Drive

# Database names
DATABASES=(
    "sbc_user_dev"
    "sbc_payment_dev" 
    "sbc_product_dev"
    "sbc_notification_dev"
    "sbc_advertising_dev"
    "sbc_tombola_dev"
    "sbc_settings_dev"
)

# Create timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="mongodb_backup_$TIMESTAMP"
FULL_BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Error handling
handle_error() {
    log "ERROR: $1"
    cleanup
    exit 1
}

# Cleanup function
cleanup() {
    log "Cleaning up temporary files..."
    rm -rf "$FULL_BACKUP_PATH"
}

# Create backup directory
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log "Starting MongoDB backup process..."

# Create backup directory for this session
mkdir -p "$FULL_BACKUP_PATH"

# Backup each database
for db in "${DATABASES[@]}"; do
    log "Backing up database: $db"
    
    mongodump --uri="$MONGODB_URI" \
              --db="$db" \
              --out="$FULL_BACKUP_PATH" \
              --gzip
    
    if [ $? -eq 0 ]; then
        log "Successfully backed up $db"
    else
        handle_error "Failed to backup $db"
    fi
done

# Create compressed archive
log "Creating compressed archive..."
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"

if [ $? -eq 0 ]; then
    log "Successfully created archive: ${BACKUP_NAME}.tar.gz"
else
    handle_error "Failed to create archive"
fi

# Upload to Google Drive
log "Uploading backup to Google Drive..."
rclone copy "${BACKUP_NAME}.tar.gz" "$GDRIVE_REMOTE:$GDRIVE_FOLDER/" --progress

if [ $? -eq 0 ]; then
    log "Successfully uploaded backup to Google Drive"
else
    log "WARNING: Failed to upload to Google Drive, but local backup exists"
fi

# Cleanup local temporary files
cleanup

# Remove old local backups
log "Cleaning up old local backups (older than $RETENTION_DAYS days)..."
find "$BACKUP_DIR" -name "mongodb_backup_*.tar.gz" -mtime +$RETENTION_DAYS -delete

# Remove old Google Drive backups
log "Cleaning up old Google Drive backups (older than $GDRIVE_RETENTION_DAYS days)..."
rclone delete "$GDRIVE_REMOTE:$GDRIVE_FOLDER/" --min-age "${GDRIVE_RETENTION_DAYS}d"

# Calculate backup size
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" 2>/dev/null | cut -f1)
log "Backup completed successfully. Size: $BACKUP_SIZE"

# Send notification (optional - requires notification service)
# curl -X POST "http://localhost:3002/api/notifications/internal/create" \
#      -H "Content-Type: application/json" \
#      -H "Authorization: Bearer YOUR_SERVICE_SECRET" \
#      -d '{
#        "userId": "admin",
#        "title": "MongoDB Backup Completed",
#        "message": "Backup completed successfully. Size: '$BACKUP_SIZE'",
#        "type": "system"
#      }'

log "Backup process completed successfully!"
