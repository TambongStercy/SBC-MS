#!/bin/bash

# Update environment files for local MongoDB
# This script helps update .env files across all services

echo "Updating environment configuration for local MongoDB..."

# Services that need MongoDB configuration
SERVICES=(
    "user-service"
    "payment-service"
    "product-service"
    "notification-service"
    "advertising-service"
    "tombola-service"
    "settings-service"
)

# Function to update .env file
update_env_file() {
    local service_dir=$1
    local env_file="$service_dir/.env"
    
    echo "Updating $env_file..."
    
    if [ -f "$env_file" ]; then
        # Backup original
        cp "$env_file" "$env_file.backup"
        
        # Update MongoDB URI to use authentication, preserving the db name
        sed -i -E 's|MONGO_URI=(mongodb(\+srv)?://)?[^@]+@[^/]+/([^?&]+).*|MONGO_URI=mongodb://serviceuser:servicepassword@localhost:27017/\3|g' "$env_file"
        sed -i -E 's|MONGODB_URI=(mongodb(\+srv)?://)?[^@]+@[^/]+/([^?&]+).*|MONGODB_URI=mongodb://serviceuser:servicepassword@localhost:27017/\3|g' "$env_file"
        sed -i -E 's|MONGODB_URI_DEV=(mongodb(\+srv)?://)?[^@]+@[^/]+/([^?&]+).*|MONGODB_URI_DEV=mongodb://serviceuser:servicepassword@localhost:27017/\3|g' "$env_file"
        sed -i -E 's|MONGODB_URI_PROD=(mongodb(\+srv)?://)?[^@]+@[^/]+/([^?&]+).*|MONGODB_URI_PROD=mongodb://serviceuser:servicepassword@localhost:27017/\3|g' "$env_file"
        
        echo "Updated $env_file (backup saved as $env_file.backup)"
        echo "NOTE: Please update 'serviceuser' and 'servicepassword' in $env_file to the correct values for this service."
    else
        echo "No .env file found in $service_dir"
    fi
}

# Update each service
for service in "${SERVICES[@]}"; do
    if [ -d "$service" ]; then
        update_env_file "$service"
    else
        echo "Service directory not found: $service"
    fi
done

echo ""
echo "Environment update completed!"
echo ""
echo "Next steps:"
echo "1. Review the updated .env files"
echo "2. Ensure MongoDB is running: sudo systemctl status mongod"
echo "3. Restart your services: docker-compose down && docker-compose up -d"
echo ""
echo "If you need to revert changes, restore from .env.backup files"
