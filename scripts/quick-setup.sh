#!/bin/bash

# Quick MongoDB Migration and Backup Setup Script
# Run this script to set up everything at once

echo "MongoDB Migration and Backup Quick Setup"
echo "========================================"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "Please don't run this script as root. Use sudo when prompted."
    exit 1
fi

# Step 1: Install MongoDB
echo ""
echo "Step 1: Installing MongoDB..."
read -p "Do you want to install MongoDB? (y/n): " install_mongo
if [ "$install_mongo" = "y" ]; then
    sudo bash scripts/install-mongodb.sh
fi

# Step 2: Migration
echo ""
echo "Step 2: Data Migration"
echo "Choose migration method:"
echo "1. Direct migration from Atlas (recommended)"
echo "2. Import from Compass exports"
echo "3. Skip migration"
read -p "Enter choice (1-3): " migration_choice

case $migration_choice in
    1)
        read -p "Enter your MongoDB Atlas connection string: " atlas_uri
        sed -i "s|ATLAS_URI=.*|ATLAS_URI=\"$atlas_uri\"|" scripts/migrate-from-atlas.sh
        bash scripts/migrate-from-atlas.sh
        ;;
    2)
        read -p "Enter path to your Compass exports: " export_path
        bash scripts/import-compass-exports.sh "$export_path"
        ;;
    3)
        echo "Skipping migration..."
        ;;
esac

# Step 3: Setup Google Drive Backup
echo ""
echo "Step 3: Setting up Google Drive backup..."
read -p "Do you want to setup automated backups to Google Drive? (y/n): " setup_backup
if [ "$setup_backup" = "y" ]; then
    sudo bash scripts/setup-gdrive-backup.sh
    
    echo ""
    echo "Please configure rclone with Google Drive:"
    echo "Run: sudo rclone config"
    echo "Then come back and press Enter to continue..."
    read -p "Press Enter when rclone is configured..."
    
    # Setup backup scripts
    sudo mkdir -p /opt/mongodb-backup/scripts
    sudo cp scripts/mongodb-backup.sh /opt/mongodb-backup/scripts/
    sudo cp scripts/mongodb-restore.sh /opt/mongodb-backup/scripts/
    sudo chmod +x /opt/mongodb-backup/scripts/*.sh
    
    # Setup cron job
    bash scripts/setup-cron-backup.sh
fi

# Step 4: Update environment files
echo ""
echo "Step 4: Updating environment configuration..."
read -p "Do you want to update .env files for local MongoDB? (y/n): " update_env
if [ "$update_env" = "y" ]; then
    bash scripts/update-env-for-local-mongo.sh
fi

# Step 5: Health check
echo ""
echo "Step 5: Running health check..."
bash scripts/mongodb-health-check.sh

echo ""
echo "Setup completed!"
echo ""
echo "Next steps:"
echo "1. Review the health check output above"
echo "2. Test your application: docker-compose down && docker-compose up -d"
echo "3. Monitor backup logs: tail -f /var/log/mongodb-backup/backup.log"
echo ""
echo "Useful commands:"
echo "- Health check: bash scripts/mongodb-health-check.sh"
echo "- Manual backup: sudo /opt/mongodb-backup/scripts/mongodb-backup.sh"
echo "- List backups: bash scripts/mongodb-restore.sh list"
echo "- Restore backup: bash scripts/mongodb-restore.sh <backup_file>"
