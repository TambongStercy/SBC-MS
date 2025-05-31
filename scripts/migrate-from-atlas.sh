#!/bin/bash

# MongoDB Atlas to Local Migration Script
# Usage: bash migrate-from-atlas.sh

# Configuration
ATLAS_URI="mongodb+srv://stercytambong:w23N0S5Qb6kMUwTi@simbtech0.ljkwg8k.mongodb.net"
LOCAL_URI="mongodb://admin:admin1234@localhost:27017"
BACKUP_DIR="/tmp/mongodb_migration"



# Database names from your microservices
DATABASES=(
    "sbc_users"
    "sbc_payment" 
    "sbc_products"
    "sbc_notifications"
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
        
        # Drop existing local database before import
        echo "Dropping existing local database $db_name..."
        mongosh "$LOCAL_URI/$db_name" -u admin -p admin1234 --authenticationDatabase admin --eval "db.dropDatabase()"
        
        # Import to local MongoDB
        echo "Importing $db_name to local MongoDB..."
        mongorestore --uri="mongodb://admin:admin1234@localhost:27017/$db_name?authSource=admin" "$BACKUP_DIR/$db_name"
        
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
