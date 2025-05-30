#!/bin/bash

# MongoDB Atlas to Local Migration Script
# Usage: bash migrate-from-atlas.sh

# Configuration
ATLAS_URI="mongodb+srv://username:password@cluster.mongodb.net"
LOCAL_URI="mongodb://localhost:27017"
BACKUP_DIR="/tmp/mongodb_migration"

# Database names from your microservices
DATABASES=(
    "sbc_user"
    "sbc_payment" 
    "sbc_product"
    "sbc_notification"
    "sbc_advertising"
    "sbc_tombola"
    "sbc_settings"
)

echo "Starting MongoDB Atlas to Local Migration..."

# Create backup directory
mkdir -p $BACKUP_DIR

# Function to migrate a single database
migrate_database() {
    local db_name=$1
    echo "Migrating database: $db_name"
    
    # Export from Atlas
    echo "Exporting $db_name from Atlas..."
    mongodump --uri="$ATLAS_URI/$db_name" --out="$BACKUP_DIR"
    
    if [ $? -eq 0 ]; then
        echo "Export successful for $db_name"
        
        # Import to local MongoDB
        echo "Importing $db_name to local MongoDB..."
        mongorestore --uri="$LOCAL_URI" --db="$db_name" "$BACKUP_DIR/$db_name"
        
        if [ $? -eq 0 ]; then
            echo "Import successful for $db_name"
        else
            echo "Import failed for $db_name"
            return 1
        fi
    else
        echo "Export failed for $db_name"
        return 1
    fi
}

# Migrate each database
for db in "${DATABASES[@]}"; do
    migrate_database $db
    echo "---"
done

# Cleanup
echo "Cleaning up temporary files..."
rm -rf $BACKUP_DIR

echo "Migration completed!"
echo "Please update your application configuration to use: $LOCAL_URI"
