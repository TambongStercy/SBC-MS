#!/bin/bash

# Import MongoDB Compass exports to local MongoDB
# Usage: bash import-compass-exports.sh /path/to/compass/exports

EXPORT_DIR=$1
LOCAL_URI="mongodb://localhost:27017"

if [ -z "$EXPORT_DIR" ]; then
    echo "Usage: bash import-compass-exports.sh /path/to/compass/exports"
    exit 1
fi

echo "Importing Compass exports from: $EXPORT_DIR"

# Function to import JSON files
import_json_collection() {
    local db_name=$1
    local collection_name=$2
    local file_path=$3
    
    echo "Importing $db_name.$collection_name from $file_path"
    
    mongoimport --uri="$LOCAL_URI" \
                --db="$db_name" \
                --collection="$collection_name" \
                --file="$file_path" \
                --jsonArray
}

# Function to import BSON files (if you exported as BSON)
import_bson_collection() {
    local db_name=$1
    local collection_name=$2
    local file_path=$3
    
    echo "Importing $db_name.$collection_name from $file_path"
    
    mongorestore --uri="$LOCAL_URI" \
                 --db="$db_name" \
                 --collection="$collection_name" \
                 "$file_path"
}

# Example usage - adjust paths based on your export structure
# import_json_collection "sbc_user_dev" "users" "$EXPORT_DIR/users.json"
# import_json_collection "sbc_product_dev" "products" "$EXPORT_DIR/products.json"

echo "Import completed!"
echo "Verify your data with: mongosh $LOCAL_URI"
