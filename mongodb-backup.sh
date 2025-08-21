#!/bin/bash

# Configuration
MONGO_HOST="localhost"
MONGO_PORT="27017"
MONGO_USER=""  # Leave empty if no authentication
MONGO_PASSWORD=""  # Leave empty if no authentication
GCS_BUCKET="db-backups-vps"  # Replace with your actual bucket name
BACKUP_DIR="/tmp/mongodb-backups"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="mongodb_backup_$DATE"

# Create backup directory
mkdir -p $BACKUP_DIR

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting MongoDB backup process..."

# Create the backup
if [ -z "$MONGO_USER" ]; then
    # No authentication
    log "Creating backup without authentication..."
    mongodump --host $MONGO_HOST:$MONGO_PORT --out $BACKUP_DIR/$BACKUP_NAME
else
    # With authentication
    log "Creating backup with authentication..."
    mongodump --host $MONGO_HOST:$MONGO_PORT --username $MONGO_USER --password $MONGO_PASSWORD --out $BACKUP_DIR/$BACKUP_NAME
fi

# Check if backup was successful
if [ $? -eq 0 ]; then
    log "MongoDB backup created successfully"
    
    # Compress the backup
    log "Compressing backup..."
    cd $BACKUP_DIR
    tar -czf $BACKUP_NAME.tar.gz $BACKUP_NAME
    
    if [ $? -eq 0 ]; then
        log "Backup compressed successfully"
        
        # Upload to Google Cloud Storage
        log "Uploading backup to Google Cloud Storage..."
        gsutil cp $BACKUP_NAME.tar.gz gs://$GCS_BUCKET/mongodb-backups/
        
        if [ $? -eq 0 ]; then
            log "Backup uploaded successfully to gs://$GCS_BUCKET/mongodb-backups/$BACKUP_NAME.tar.gz"
            
            # Clean up local files
            log "Cleaning up local backup files..."
            rm -rf $BACKUP_DIR/$BACKUP_NAME
            rm -f $BACKUP_DIR/$BACKUP_NAME.tar.gz
            
            log "Backup process completed successfully"
        else
            log "ERROR: Failed to upload backup to Google Cloud Storage"
            exit 1
        fi
    else
        log "ERROR: Failed to compress backup"
        exit 1
    fi
else
    log "ERROR: Failed to create MongoDB backup"
    exit 1
fi

# Optional: Remove backups older than 30 days from GCS
log "Removing backups older than 30 days from GCS..."
gsutil -m rm gs://$GCS_BUCKET/mongodb-backups/mongodb_backup_$(date -d '30 days ago' +"%Y%m%d")*.tar.gz 2>/dev/null || true

log "Backup script finished"