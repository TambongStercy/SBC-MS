#!/bin/bash

# MongoDB Restore Script
# Usage: bash mongodb-restore.sh [backup_file] [database_name]

MONGODB_URI="mongodb://localhost:27017"
GDRIVE_REMOTE="gdrive"
GDRIVE_FOLDER="mongodb-backups"
TEMP_DIR="/tmp/mongodb_restore"

# Function to list available backups
list_backups() {
    echo "Available local backups:"
    ls -la /opt/mongodb-backup/temp/*.tar.gz 2>/dev/null || echo "No local backups found"
    
    echo ""
    echo "Available Google Drive backups:"
    rclone ls "$GDRIVE_REMOTE:$GDRIVE_FOLDER/" | grep "\.tar\.gz$"
}

# Function to download backup from Google Drive
download_backup() {
    local backup_name=$1
    echo "Downloading $backup_name from Google Drive..."
    
    mkdir -p "$TEMP_DIR"
    rclone copy "$GDRIVE_REMOTE:$GDRIVE_FOLDER/$backup_name" "$TEMP_DIR/"
    
    if [ $? -eq 0 ]; then
        echo "Download completed: $TEMP_DIR/$backup_name"
        return 0
    else
        echo "Download failed"
        return 1
    fi
}

# Function to restore from backup
restore_backup() {
    local backup_file=$1
    local target_db=$2
    
    echo "Restoring from: $backup_file"
    
    # Extract backup
    local extract_dir="$TEMP_DIR/extract"
    mkdir -p "$extract_dir"
    
    tar -xzf "$backup_file" -C "$extract_dir"
    
    if [ -n "$target_db" ]; then
        # Restore specific database
        echo "Restoring database: $target_db"
        mongorestore --uri="$MONGODB_URI" \
                     --db="$target_db" \
                     --gzip \
                     "$extract_dir"/*/"$target_db"
    else
        # Restore all databases
        echo "Restoring all databases..."
        mongorestore --uri="$MONGODB_URI" \
                     --gzip \
                     "$extract_dir"/*
    fi
    
    # Cleanup
    rm -rf "$extract_dir"
}

# Main script logic
if [ $# -eq 0 ]; then
    echo "MongoDB Restore Script"
    echo "Usage:"
    echo "  $0 list                           - List available backups"
    echo "  $0 <backup_file>                  - Restore all databases from backup"
    echo "  $0 <backup_file> <database_name>  - Restore specific database"
    echo ""
    echo "Examples:"
    echo "  $0 mongodb_backup_20241220_143000.tar.gz"
    echo "  $0 mongodb_backup_20241220_143000.tar.gz sbc_user_dev"
    exit 1
fi

if [ "$1" = "list" ]; then
    list_backups
    exit 0
fi

BACKUP_FILE=$1
DATABASE_NAME=$2

# Check if backup file exists locally
if [ -f "/opt/mongodb-backup/temp/$BACKUP_FILE" ]; then
    restore_backup "/opt/mongodb-backup/temp/$BACKUP_FILE" "$DATABASE_NAME"
elif [ -f "$BACKUP_FILE" ]; then
    restore_backup "$BACKUP_FILE" "$DATABASE_NAME"
else
    # Try to download from Google Drive
    echo "Backup not found locally. Attempting to download from Google Drive..."
    if download_backup "$BACKUP_FILE"; then
        restore_backup "$TEMP_DIR/$BACKUP_FILE" "$DATABASE_NAME"
        rm -f "$TEMP_DIR/$BACKUP_FILE"
    else
        echo "Backup file not found locally or in Google Drive"
        exit 1
    fi
fi

echo "Restore completed!"
